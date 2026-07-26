import type { AppConfig } from '../../config/index.js';
import type { Repositories } from '../../db/repositories.js';
import { logger } from '../../logger.js';
import type { TaskDispatcher } from '../../queue/taskQueue.js';
import type { TaskRecord } from '../../types.js';
import { PaperclipClient, type PaperclipAgent, type PaperclipIssue } from './client.js';

export interface PaperclipHeartbeatPayload {
  runId: string;
  agentId: string;
  companyId?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PaperclipTaskLink {
  issueId: string;
  runId?: string;
  agentId?: string;
  companyId?: string;
  projectId?: string;
  goalId?: string;
}

export function paperclipTaskLink(task: TaskRecord): PaperclipTaskLink | null {
  const raw = task.planning_metadata?.paperclip;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.issueId !== 'string' || !value.issueId) return null;
  return {
    issueId: value.issueId,
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    agentId: typeof value.agentId === 'string' ? value.agentId : undefined,
    companyId: typeof value.companyId === 'string' ? value.companyId : undefined,
    projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
    goalId: typeof value.goalId === 'string' ? value.goalId : undefined
  };
}

export function resolveTeleOpcAgent(agent: PaperclipAgent | null, context: Record<string, unknown> = {}) {
  const explicit = typeof context.teleOpcAgent === 'string' ? context.teleOpcAgent.trim() : '';
  if (explicit) return explicit;
  const haystack = [agent?.shortname, agent?.urlKey, agent?.name, agent?.role]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase();
  const mappings: Array<[string[], string]> = [
    [['finance', '财务'], 'finance'],
    [['sales', 'prospect', '销售', '商务'], 'prospecting'],
    [['research', 'analyst', '研究', '分析'], 'research'],
    [['content', 'marketing', 'writer', '内容', '营销'], 'content'],
    [['email', 'mail', '邮件'], 'email'],
    [['browser', 'web', '浏览器'], 'browser'],
    [['developer', 'engineer', 'cto', 'dev', '研发', '工程'], 'dev'],
    [['operations', 'operator', 'ops', '运营'], 'ops'],
    [['crm', 'customer', '客户'], 'crm']
  ];
  for (const [needles, target] of mappings) {
    if (needles.some((needle) => haystack.includes(needle))) return target;
  }
  return 'chief_of_staff';
}

function paperclipIssueId(payload: PaperclipHeartbeatPayload) {
  const context = payload.context ?? {};
  const value = context.issueId ?? context.taskId;
  return typeof value === 'string' && value ? value : null;
}

function taskPriority(value: unknown) {
  const priority = typeof value === 'string' ? value.toLowerCase() : 'normal';
  if (priority === 'urgent' || priority === 'critical') return 'urgent';
  if (priority === 'high') return 'high';
  if (priority === 'low') return 'low';
  return 'normal';
}

function taskRisk(value: unknown): 'low' | 'medium' | 'high' {
  const priority = typeof value === 'string' ? value.toLowerCase() : '';
  if (priority === 'urgent' || priority === 'critical') return 'high';
  if (priority === 'high') return 'high';
  if (priority === 'medium') return 'medium';
  return 'low';
}

export class PaperclipBridge {
  readonly client: PaperclipClient;

  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repositories,
    private readonly dispatcher: TaskDispatcher
  ) {
    this.client = new PaperclipClient({ apiUrl: config.paperclip.apiUrl, apiKey: config.paperclip.apiKey });
  }

  async acceptHeartbeat(payload: PaperclipHeartbeatPayload) {
    const issueId = paperclipIssueId(payload);
    if (!issueId) throw new Error('paperclip heartbeat missing context.issueId/taskId');

    const existing = await this.repos.findTaskByExternalReference('paperclip', issueId);
    if (existing) {
      await this.syncExistingTask(existing, payload.runId);
      return { created: false, task: existing, issueId };
    }

    const context = payload.context ?? {};
    const issue = await this.loadIssue(issueId, context);
    const agent = await this.loadAgent(payload.agentId);
    const ownerAgent = resolveTeleOpcAgent(agent, context);
    const task = await this.repos.createTask({
      title: issue.title || `Paperclip issue ${issueId}`,
      description: issue.description ?? undefined,
      ownerAgent,
      priority: taskPriority(issue.priority),
      riskLevel: taskRisk(issue.priority),
      status: 'queued',
      planningMetadata: {
        workflow: 'paperclip_issue',
        source: 'paperclip_http_adapter',
        paperclip: {
          issueId,
          runId: payload.runId,
          agentId: payload.agentId,
          companyId: payload.companyId ?? issue.companyId,
          projectId: issue.projectId,
          goalId: issue.goalId,
          wakeReason: context.wakeReason,
          commentId: context.commentId
        }
      }
    });
    await this.repos.recordBusinessAnalyticsFact({
      id: `baf_paperclip_received_${issueId}`,
      grain: 'event', scope: 'execution', metric_code: 'paperclip_issue_received', metric_name: 'Paperclip 任务接入', metric_value: 1,
      agent: ownerAgent, stage: typeof issue.priority === 'string' ? issue.priority : null, status: 'queued', note: issue.title,
      source_object_type: 'paperclip_issue', source_object_id: issueId, is_demo: false,
      metadata: { run_id: payload.runId, paperclip_agent_id: payload.agentId }
    });
    await this.repos.audit({
      actorType: 'paperclip', actorId: payload.agentId, action: 'paperclip_issue_accepted', entityType: 'task', entityId: task.id,
      metadata: { issueId, runId: payload.runId, ownerAgent }
    });
    await this.dispatcher.enqueueTask({ taskId: task.id, source: 'intake' });
    // Do not add a Paperclip comment here. Paperclip treats comments as wake signals,
    // which can recursively invoke the HTTP adapter. Status-only sync keeps the bridge quiet.
    await this.client.updateIssue(issueId, {
      status: 'in_progress'
    }, payload.runId).catch((error) => {
      logger.warn({ issueId, taskId: task.id, error: error instanceof Error ? error.message : String(error) }, 'Paperclip issue start callback failed');
    });
    return { created: true, task, issueId };
  }

  async syncTaskResult(task: TaskRecord, status: 'done' | 'failed', detail: string) {
    if (!this.config.paperclip.enabled || !this.config.paperclip.apiUrl) return false;
    const link = paperclipTaskLink(task);
    if (!link) return false;
    const paperclipStatus = status === 'done' ? 'done' : 'blocked';
    // Paperclip comments are wake signals. Keep asynchronous completion status-only
    // and retain details in Tele-OPC audit/business facts to avoid heartbeat loops.
    await this.client.updateIssue(link.issueId, { status: paperclipStatus }, link.runId);
    await this.repos.recordBusinessAnalyticsFact({
      id: `baf_paperclip_${status}_${link.issueId}`,
      grain: 'event', scope: 'execution', metric_code: status === 'done' ? 'paperclip_issue_done' : 'paperclip_issue_failed',
      metric_name: status === 'done' ? 'Paperclip 任务完成' : 'Paperclip 任务失败', metric_value: 1,
      agent: task.owner_agent, status: paperclipStatus, note: task.title,
      source_object_type: 'paperclip_issue', source_object_id: link.issueId, is_demo: false,
      metadata: { tele_opc_task_id: task.id, run_id: link.runId }
    });
    return true;
  }

  private async syncExistingTask(task: TaskRecord, runId: string) {
    const link = paperclipTaskLink(task);
    if (!link) return;
    const status = task.status === 'done' ? 'done' : task.status === 'failed' ? 'blocked' : 'in_progress';
    await this.client.updateIssue(link.issueId, { status }, runId).catch(() => undefined);
  }

  private async loadIssue(issueId: string, context: Record<string, unknown>): Promise<PaperclipIssue> {
    try { return await this.client.getIssue(issueId); }
    catch (error) {
      const title = typeof context.title === 'string' ? context.title : `Paperclip issue ${issueId}`;
      const description = typeof context.description === 'string' ? context.description : null;
      logger.warn({ issueId, error: error instanceof Error ? error.message : String(error) }, 'Paperclip issue lookup failed; using heartbeat context');
      return { id: issueId, title, description, priority: typeof context.priority === 'string' ? context.priority : null };
    }
  }

  private async loadAgent(agentId: string): Promise<PaperclipAgent | null> {
    try { return await this.client.getAgent(agentId); }
    catch { return null; }
  }
}

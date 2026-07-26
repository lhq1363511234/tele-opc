import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config/index.js';
import type { Repositories } from '../../db/repositories.js';
import type { BusinessAnalyticsFactRecord, TaskRecord } from '../../types.js';
import { PaperclipClient, type PaperclipIssue } from './client.js';

const createIssueSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000).optional().default(''),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  assigneeAgentId: z.string().uuid().optional().nullable()
});

const updateIssueSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled']).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  assigneeAgentId: z.string().uuid().optional().nullable()
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required');

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function taskIssueId(task: TaskRecord) {
  const paperclip = asRecord(asRecord(task.planning_metadata).paperclip);
  return typeof paperclip.issueId === 'string' ? paperclip.issueId : null;
}

function publicTask(task: TaskRecord | undefined) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    ownerAgent: task.owner_agent,
    priority: task.priority,
    riskLevel: task.risk_level,
    result: task.result,
    createdAt: task.created_at,
    updatedAt: task.updated_at
  };
}

function publicCompany(company: Record<string, unknown>) {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    status: company.status,
    brandColor: company.brandColor,
    budgetMonthlyCents: company.budgetMonthlyCents,
    spentMonthlyCents: company.spentMonthlyCents,
    issuePrefix: company.issuePrefix,
    updatedAt: company.updatedAt
  };
}

function publicAgent(agent: Record<string, unknown>) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    title: agent.title,
    icon: agent.icon,
    status: agent.status,
    reportsTo: agent.reportsTo,
    capabilities: agent.capabilities,
    adapterType: agent.adapterType,
    budgetMonthlyCents: agent.budgetMonthlyCents,
    spentMonthlyCents: agent.spentMonthlyCents,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    errorReason: agent.errorReason,
    pauseReason: agent.pauseReason,
    urlKey: agent.urlKey
  };
}

function publicProject(project: Record<string, unknown>) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color,
    icon: project.icon,
    goalId: project.goalId,
    goalIds: project.goalIds,
    goals: project.goals,
    leadAgentId: project.leadAgentId,
    targetDate: project.targetDate,
    taskCount: project.taskCount,
    updatedAt: project.updatedAt
  };
}

function publicIssue(issue: PaperclipIssue, taskMap: Map<string, TaskRecord>) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    projectId: issue.projectId,
    goalId: issue.goalId,
    parentId: issue.parentId,
    assigneeAgentId: issue.assigneeAgentId,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    startedAt: issue.startedAt,
    completedAt: issue.completedAt,
    lastActivityAt: issue.lastActivityAt,
    activeRun: issue.activeRun ? {
      id: asRecord(issue.activeRun).id,
      status: asRecord(issue.activeRun).status,
      startedAt: asRecord(issue.activeRun).startedAt
    } : null,
    teleOpcTask: publicTask(taskMap.get(issue.id))
  };
}

async function resolveCompany(client: PaperclipClient, configuredCompanyId: string) {
  const companies = await client.listCompanies();
  const company = configuredCompanyId
    ? companies.find((item) => item.id === configuredCompanyId)
    : companies[0];
  if (!company) throw new Error(configuredCompanyId ? 'configured Paperclip company not found' : 'no Paperclip company found');
  return company;
}

function executionSummary(facts: BusinessAnalyticsFactRecord[]) {
  const count = (metricCode: string) => facts.filter((fact) => fact.metric_code === metricCode).length;
  const received = count('paperclip_issue_received');
  const done = count('paperclip_issue_done');
  const failed = count('paperclip_issue_failed');
  const completed = done + failed;
  const byAgent = new Map<string, { received: number; done: number; failed: number }>();
  for (const fact of facts) {
    const agent = typeof fact.agent === 'string' && fact.agent ? fact.agent : 'unassigned';
    const row = byAgent.get(agent) ?? { received: 0, done: 0, failed: 0 };
    if (fact.metric_code === 'paperclip_issue_received') row.received += 1;
    if (fact.metric_code === 'paperclip_issue_done') row.done += 1;
    if (fact.metric_code === 'paperclip_issue_failed') row.failed += 1;
    byAgent.set(agent, row);
  }
  return {
    received,
    done,
    failed,
    successRate: completed ? Math.round(done / completed * 1000) / 10 : 0,
    byAgent: [...byAgent.entries()].map(([agent, values]) => ({ agent, ...values })),
    recentFacts: facts.slice(0, 24).map((fact) => ({
      id: fact.id,
      metricCode: fact.metric_code,
      metricName: fact.metric_name,
      status: fact.status,
      agent: fact.agent,
      note: fact.note,
      issueId: fact.source_object_id,
      occurredAt: fact.occurred_at
    }))
  };
}

export function registerPaperclipWebRoutes(
  app: FastifyInstance<any, any, any, any>,
  config: AppConfig,
  repos: Repositories,
  allowWebConsoleAccess: any
) {
  const client = new PaperclipClient({ apiUrl: config.paperclip.apiUrl, apiKey: config.paperclip.apiKey });
  const routeOptions = { preHandler: allowWebConsoleAccess };

  app.get('/api/web/paperclip', routeOptions, async (_request, reply) => {
    if (!config.paperclip.enabled || !config.paperclip.apiKey) {
      reply.code(503);
      return { ok: false, error: 'paperclip_not_configured' };
    }
    try {
      const company = await resolveCompany(client, config.paperclip.companyId);
      const [goals, projects, agents, issues, dashboard, tasks, facts] = await Promise.all([
        client.listGoals(company.id),
        client.listProjects(company.id),
        client.listAgents(company.id),
        client.listIssues(company.id),
        client.getDashboard(company.id),
        repos.listPaperclipTasks(500),
        repos.listBusinessAnalyticsFactsBySource('paperclip_issue', 1500)
      ]);
      const taskMap = new Map(tasks.map((task) => [taskIssueId(task), task]).filter((item): item is [string, TaskRecord] => Boolean(item[0])));
      const issueCounts = issues.reduce<Record<string, number>>((counts, issue) => {
        const status = typeof issue.status === 'string' ? issue.status : 'unknown';
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {});
      return {
        ok: true,
        connected: true,
        generatedAt: new Date().toISOString(),
        company: publicCompany(company),
        goals,
        projects: projects.map(publicProject),
        agents: agents.map((agent) => publicAgent(agent as Record<string, unknown>)),
        issues: issues.map((issue) => publicIssue(issue, taskMap)),
        issueCounts,
        dashboard,
        execution: {
          linkedTasks: tasks.length,
          ...executionSummary(facts)
        }
      };
    } catch (error) {
      reply.code(502);
      return { ok: false, error: 'paperclip_unavailable', message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get<{ Params: { id: string } }>('/api/web/paperclip/issues/:id', routeOptions, async (request, reply) => {
    try {
      const [issue, runs, comments, task, facts] = await Promise.all([
        client.getIssue(request.params.id),
        client.listIssueRuns(request.params.id),
        client.listIssueComments(request.params.id),
        repos.findTaskByExternalReference('paperclip', request.params.id),
        repos.listBusinessAnalyticsFactsBySource('paperclip_issue', 1500)
      ]);
      const taskMap = new Map<string, TaskRecord>();
      if (task) taskMap.set(request.params.id, task);
      return {
        ok: true,
        issue: publicIssue(issue, taskMap),
        runs: runs.map((run) => ({
          runId: run.runId,
          status: run.status,
          adapterType: run.adapterType,
          invocationSource: run.invocationSource,
          livenessState: run.livenessState,
          livenessReason: run.livenessReason,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errorCode: run.errorCode
        })),
        comments: comments.slice(0, 50).map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          authorType: comment.authorType,
          authorAgentId: comment.authorAgentId,
          authorUserId: comment.authorUserId
        })),
        facts: facts.filter((fact) => fact.source_object_id === request.params.id).slice(0, 30)
      };
    } catch (error) {
      reply.code(502);
      return { ok: false, error: 'paperclip_issue_unavailable', message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post<{ Body: unknown }>('/api/web/paperclip/issues', routeOptions, async (request, reply) => {
    const parsed = createIssueSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_paperclip_issue', issues: parsed.error.issues };
    }
    try {
      const company = await resolveCompany(client, config.paperclip.companyId);
      const issue = await client.createIssue(company.id, {
        ...parsed.data,
        description: parsed.data.description || null,
        status: 'todo'
      });
      await repos.audit({
        actorType: 'web_console',
        actorId: 'owner',
        action: 'paperclip_issue_created',
        entityType: 'paperclip_issue',
        entityId: issue.id,
        metadata: { companyId: company.id, assigneeAgentId: issue.assigneeAgentId, priority: issue.priority }
      });
      reply.code(201);
      return { ok: true, issue };
    } catch (error) {
      reply.code(502);
      return { ok: false, error: 'paperclip_issue_create_failed', message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/web/paperclip/issues/:id', routeOptions, async (request, reply) => {
    const parsed = updateIssueSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_paperclip_issue_update', issues: parsed.error.issues };
    }
    try {
      const issue = await client.updateIssue(request.params.id, parsed.data);
      await repos.audit({
        actorType: 'web_console',
        actorId: 'owner',
        action: 'paperclip_issue_updated',
        entityType: 'paperclip_issue',
        entityId: issue.id,
        metadata: parsed.data
      });
      return { ok: true, issue };
    } catch (error) {
      reply.code(502);
      return { ok: false, error: 'paperclip_issue_update_failed', message: error instanceof Error ? error.message : String(error) };
    }
  });
}

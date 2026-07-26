import { getAgentDefinition, listAgentDefinitions } from '../agents/registry.js';
import type { AgentRunResult, AgentRunner } from '../ai/agentRunner.js';
import { buildCoreAgentTools } from '../ai/agentTools.js';
import { systemPromptForAgent } from '../ai/agentPrompts.js';
import { isBrowserDashboardRequest, parseBrowserInstruction } from '../browser/browserIntake.js';
import { isCalendarDashboardRequest, parseCalendarInstruction } from '../calendar/calendarIntake.js';
import { parseCrmLeadInstruction } from '../crm/crmIntake.js';
import type { Repositories } from '../db/repositories.js';
import { isMailDashboardRequest, parseEmailRecordInstruction } from '../email/emailIntake.js';
import { isFinanceDashboardRequest, parseFinanceInstruction } from '../finance/financeIntake.js';
import { intakeMessage } from '../intake/intake.js';
import { buildDraftContext, charLength, type DraftContext } from '../memory/draftContext.js';
import { buildContextPack, contextPackForAgentRuntime, summarizeContextPackForBriefing } from './contextPack.js';
import { routeCommand } from './commandRouter.js';
import { isMemoryType, parseMemoryInstruction, supportedMemoryTypes } from '../memory/memoryIntake.js';
import { LocalAuditExporter, type AuditExportResult } from '../ops/auditExport.js';
import { LocalBackupRunner, type BackupResult } from '../ops/backup.js';
import { LocalEvaluationRunner, type EvaluationRunResult } from '../ops/evaluation.js';
import { LocalIntegrationHealthChecker, type IntegrationHealthResult } from '../ops/healthCheck.js';
import { approvalPromptFor, requiresApproval } from '../policy/approvalPolicy.js';
import { isRetryableTaskStatus } from '../policy/retryPolicy.js';
import { createTaskPlan, type TaskPlan } from '../planner/taskPlanner.js';
import {
  buildProspectingDraft,
  buildProspectingLeadCandidates,
  renderProspectingDraft,
  renderProspectingLeadCandidates,
  type ProspectingDraft,
  type ProspectingLeadCandidate
} from '../prospecting/prospectingEngine.js';
import { PublicSourceProspectingConnector, type ProspectingSourceConnector } from '../prospecting/publicSourceConnector.js';
import { buildQuoteDraft, parsePricingRules, renderImportedPricingRules, renderQuoteDraft, type QuoteDraft } from '../quote/quoteEngine.js';
import { NoopTaskDispatcher, type TaskDispatcher, type TaskJobData } from '../queue/taskQueue.js';
import { createReviewDraft } from '../review/reviewIntake.js';
import { buildSolutionDraft, renderSolutionDraft } from '../solution/solutionEngine.js';
import { getSkillDefinition, listSkills } from '../skills/registry.js';
import { createTaskContract, planContentWorkStrategy } from '../work/workStrategy.js';
import type {
  AvailabilityWindowRecord,
  AgentRunRecord,
  AuditExportRecord,
  BackupRunRecord,
  BrowserBlockedActionRecord,
  BrowserExtractionRecord,
  BrowserRunRecord,
  BrowserScreenshotRecord,
  CalendarEventRecord,
  ContactRecord,
  EmailDraftRecord,
  EmailThreadRecord,
  EvaluationCaseRecord,
  EvaluationRunRecord,
  FollowUpRecord,
  IntegrationHealthCheckRecord,
  InvoiceRecord,
  CampaignEventRecord,
  CampaignRecord,
  MeetingNoteRecord,
  MemoryType,
  PendingApprovalRecord,
  PermissionProfileRecord,
  RetryEventRecord,
  RiskLevel,
  SubscriptionRecord,
  TaskRecord,
  TaskStatus,
  ToolCallRecord,
  TransactionRecord
} from '../types.js';

export interface BrainContext {
  telegramUserId: number;
  userId: string;
  chatId: string;
  originMessageId?: string;
}

interface RecentChatMessage {
  id: string;
  direction: string;
  text: string | null;
  created_at: string;
}

type ChiefIntentRoute = 'question' | 'task' | 'continuation' | 'progress' | 'content' | 'domain_record' | 'unknown';

type ChiefIntentTargetWorkflow =
  | 'memory'
  | 'crm'
  | 'email'
  | 'mail_dashboard'
  | 'finance'
  | 'finance_dashboard'
  | 'calendar'
  | 'calendar_dashboard'
  | 'browser'
  | 'browser_dashboard'
  | 'solution'
  | 'prospecting'
  | 'quote'
  | 'review'
  | 'dev'
  | 'ops'
  | 'market_scan'
  | 'unknown';

interface ChiefIntentDecision {
  route: ChiefIntentRoute;
  confidence: number;
  reason?: string;
  targetWorkflow?: ChiefIntentTargetWorkflow;
}

const ACTIVE_CONTEXT_TASK_STATUSES: TaskStatus[] = [
  'new',
  'intake',
  'planned',
  'waiting_approval',
  'queued',
  'running',
  'waiting_external',
  'blocked',
  'review',
  'failed'
];

export type ChiefOfStaffRepositories = Pick<
  Repositories,
  | 'audit'
  | 'createTaskDependency'
  | 'createBrowserRun'
  | 'createCalendarEntry'
  | 'createCrmLead'
  | 'createEmailTriageEntry'
  | 'createFinanceEntry'
  | 'createPlaybook'
  | 'createProspectingRun'
  | 'createProspectingLeadBundle'
  | 'createCampaignEvent'
  | 'createReview'
  | 'createSolutionRun'
  | 'createAgentRun'
  | 'createArtifact'
  | 'createToolCall'
  | 'createMemory'
  | 'createApproval'
  | 'createAuditExport'
  | 'createBackupRun'
  | 'createBriefing'
  | 'createEvaluationResult'
  | 'createEvaluationRun'
  | 'createIntegrationHealthCheck'
  | 'createRetryEvent'
  | 'createTask'
  | 'getTask'
  | 'getCampaign'
  | 'getBrowserDashboard'
  | 'getCrmDashboard'
  | 'getCalendarDashboard'
  | 'getFinanceDashboard'
  | 'getMailDashboard'
  | 'getOpsDashboard'
  | 'getAgentRun'
  | 'listMemories'
  | 'listAuditLogs'
  | 'listActiveEvaluationCases'
  | 'listAgentRuns'
  | 'listToolCallsForAgentRun'
  | 'listBackupTableRows'
  | 'listCampaignEvents'
  | 'listCampaigns'
  | 'listProspectingLeads'
  | 'searchLeads'
  | 'getASelfProfile'
  | 'listLeadsForProspectingRun'
  | 'listRecentMessagesForChat'
  | 'listPendingApprovals'
  | 'listPlaybooks'
  | 'listReviews'
  | 'listSubtasks'
  | 'listTasks'
  | 'listTasksByStatuses'
  | 'updateApprovalStatus'
  | 'updateAgentRun'
  | 'updateAuditExportStatus'
  | 'updateBackupRunStatus'
  | 'updateEvaluationRunStatus'
  | 'updateBrowserBlockedActionApproval'
  | 'updateEmailDraftApproval'
  | 'updateRetryEventStatus'
  | 'updateTaskStatus'
  | 'updateToolCall'
>;

export interface AuditExporter {
  exportRecent(params: {
    requestedByUserId?: string;
    limit?: number;
  }): Promise<AuditExportResult>;
}

export interface BackupRunner {
  runManual(params: {
    requestedByUserId?: string;
    rowLimit?: number;
  }): Promise<BackupResult>;
}

export interface IntegrationHealthChecker {
  runAll(): Promise<IntegrationHealthResult>;
}

export interface EvaluationRunner {
  runManual(params: {
    requestedByUserId?: string;
  }): Promise<EvaluationRunResult>;
}

type HandoffExecutionMode = 'parallel' | 'sequence';

interface SpecialistHandoffPlan {
  goal: string;
  executionMode: HandoffExecutionMode;
  agents: Array<{
    agentId: string;
    name?: string;
    role?: string;
    reason?: string;
  }>;
  reason?: string;
  sourceToolCallId?: string;
}

interface SpecialistHandoffExecution {
  task: TaskRecord;
  plan: SpecialistHandoffPlan;
  chiefRunId: string;
  results: Array<{
    agentId: string;
    result: AgentRunResult | null;
    attempts: number;
  }>;
}

export class ChiefOfStaff {
  constructor(
    private readonly repos: ChiefOfStaffRepositories,
    private readonly taskDispatcher: TaskDispatcher = new NoopTaskDispatcher(),
    private readonly auditExporter: AuditExporter = new LocalAuditExporter(repos),
    private readonly backupRunner: BackupRunner = new LocalBackupRunner(repos),
    private readonly healthChecker: IntegrationHealthChecker = new LocalIntegrationHealthChecker(repos),
    private readonly evaluationRunner: EvaluationRunner = new LocalEvaluationRunner(repos),
    private readonly agentRunner: AgentRunner | null = null,
    private readonly prospectingConnector: ProspectingSourceConnector = new PublicSourceProspectingConnector()
  ) {}

  async handleText(text: string | undefined, context: BrainContext) {
    const intake = intakeMessage(text);

    if (intake.kind === 'empty') {
      return '我现在只处理文本消息。你可以发送 `/today` 查看今日控制台。';
    }

    if (intake.kind === 'command') {
      return this.handleCommand(intake.normalizedText, context);
    }

    if (isPresentationCreationRequest(intake.normalizedText) && !requiresApproval(intake)) {
      return this.createContentWorkflow(intake.normalizedText, context);
    }

    const chiefIntent = await this.classifyChiefIntent(intake, context);

    if (chiefIntent?.route === 'question') {
      return this.handleChiefQuestion(intake.normalizedText, context, {
        chiefIntent
      });
    }

    // Goal decomposition only applies to genuine new work items. Content and
    // domain-record routes have their own handlers and must not burn a run here.
    const structuredPlan = (chiefIntent?.route === 'task'
      ? await this.planGoalWithAI(intake.normalizedText, context)
      : null)
      ?? createTaskPlan(intake.normalizedText);

    if (
      chiefIntent?.targetWorkflow === 'market_scan'
      && (chiefIntent.route === 'task' || chiefIntent.route === 'domain_record')
      && !requiresApproval(intake)
    ) {
      return this.createMarketScanWorkflow(intake.normalizedText, context);
    }

    if (
      chiefIntent?.targetWorkflow === 'prospecting'
      && (chiefIntent.route === 'task' || chiefIntent.route === 'domain_record')
      && !requiresApproval(intake)
    ) {
      return this.createLeadCampaignWorkflow(intake.normalizedText, context);
    }

    if (chiefIntent?.route === 'content' && !structuredPlan && !requiresApproval(intake)) {
      return this.createContentWorkflow(intake.normalizedText, context);
    }

    if (chiefIntent?.route === 'continuation' || (!chiefIntent && isContinuationOnly(intake.normalizedText))) {
      const continuation = await this.handleContinuation(intake.normalizedText, context);
      if (continuation) return continuation;
      if (chiefIntent?.route === 'continuation') {
        return this.continueLatestExecutableTask(intake.normalizedText, context, 'ai_classified_continuation');
      }
    }

    if (chiefIntent?.route === 'progress' || (!chiefIntent && isProgressNudge(intake.normalizedText))) {
      const progress = await this.handleProgressNudge(intake.normalizedText, context);
      if (progress) return progress;
      if (chiefIntent?.route === 'progress') {
        return this.continueLatestExecutableTask(intake.normalizedText, context, 'ai_classified_progress');
      }
    }

    const memory = parseMemoryInstruction(intake.normalizedText);
    if (memory) {
      const record = await this.repos.createMemory({
        type: memory.type,
        content: memory.content,
        createdByUserId: context.userId,
        source: {
          sourceType: 'telegram_message',
          sourceId: context.originMessageId,
          metadata: {
            telegramUserId: context.telegramUserId,
            chatId: context.chatId
          }
        },
        metadata: {
          reasons: memory.reasons
        }
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'memory_created',
        entityType: 'memory',
        entityId: record.id,
        metadata: {
          type: record.type,
          sourceMessageId: context.originMessageId
        }
      });
      return [
        `已写入公司记忆：${record.id}`,
        `类型：${record.type}`,
        '',
        record.content
      ].join('\n');
    }

    const crmLead = parseCrmLeadInstruction(intake.normalizedText);
    if (crmLead) {
      const created = await this.repos.createCrmLead({
        ...crmLead,
        sourceMessageId: context.originMessageId,
        createdByUserId: context.userId
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'crm_lead_created',
        entityType: 'contact',
        entityId: created.contact.id,
        metadata: {
          organizationId: created.organization?.id,
          opportunityId: created.opportunity.id,
          followUpId: created.followUp.id,
          sourceMessageId: context.originMessageId
        }
      });
      const aiResult = await this.runAIAgent('crm', intake.normalizedText, context, undefined, {
        workflow: 'crm',
        action: 'lead_capture',
        contactId: created.contact.id,
        organizationId: created.organization?.id,
        opportunityId: created.opportunity.id,
        followUpId: created.followUp.id
      }, {
        crmLead,
        created: {
          contact: created.contact,
          organization: created.organization,
          opportunity: created.opportunity,
          followUp: created.followUp
        }
      });

      return [
        `已创建 CRM 线索：${created.contact.id}`,
        `联系人：${created.contact.name}`,
        created.organization ? `公司：${created.organization.name}` : '',
        `机会：${created.opportunity.title} / ${created.opportunity.stage}`,
        `跟进：${created.followUp.id} / ${created.followUp.note}`,
        aiResult ? '' : '',
        aiResult ? this.renderAIAgentResult(aiResult) : '',
        '',
        '发送 `/crm` 查看客户看板。'
      ]
        .filter(Boolean)
        .join('\n');
    }

    const emailRecord = parseEmailRecordInstruction(intake.normalizedText);
    if (emailRecord) {
      const created = await this.repos.createEmailTriageEntry({
        ...emailRecord,
        sourceMessageId: context.originMessageId,
        createdByUserId: context.userId
      });

      const enqueueResult = created.task
        ? await this.enqueueTask(created.task.id, {
            taskId: created.task.id,
            source: 'intake'
          })
        : null;

      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'email_triage_recorded',
        entityType: 'email_thread',
        entityId: created.thread.id,
        metadata: {
          contactId: created.contact.id,
          messageId: created.message.id,
          taskId: created.task?.id,
          draftId: created.draft?.id,
          autoExecuted: Boolean(created.task),
          jobId: enqueueResult?.jobId,
          category: emailRecord.category,
          sourceMessageId: context.originMessageId
        }
      });
      const aiResult = await this.runAIAgent('email', intake.normalizedText, context, created.task?.id, {
        workflow: 'email',
        action: 'email_triage',
        threadId: created.thread.id,
        messageId: created.message.id,
        taskId: created.task?.id,
        draftId: created.draft?.id,
        category: emailRecord.category,
        needsFollowUp: emailRecord.needsFollowUp
      }, {
        emailRecord,
        created: {
          contact: created.contact,
          thread: created.thread,
          message: created.message,
          task: created.task,
          draft: created.draft
        }
      });

      return [
        `已记录邮件：${created.thread.id}`,
        `联系人：${created.contact.name}`,
        `分类：${emailRecord.category}`,
        `主题：${created.thread.subject}`,
        created.task ? `跟进任务：${created.task.id} / ${enqueueResult?.queued ? 'queued' : 'planned'}` : '',
        created.draft ? `回复草稿：${created.draft.id}` : '',
        '',
        created.task
          ? 'V3 Email Agent 已自动排队跟进任务；除财务动作外不再要求审批。'
          : '这封邮件已记录，暂未识别到需要回复的动作。',
        aiResult ? '' : '',
        aiResult ? this.renderAIAgentResult(aiResult) : '',
        '发送 `/mail` 查看邮件看板。'
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (isMailDashboardRequest(intake.normalizedText)) {
      return this.mailDashboard();
    }

    const financeEntry = parseFinanceInstruction(intake.normalizedText);
    if (financeEntry) {
      const created = await this.repos.createFinanceEntry({
        ...financeEntry,
        sourceMessageId: context.originMessageId,
        createdByUserId: context.userId
      });
      const entity = created.transaction ?? created.invoice ?? created.subscription;
      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'finance_entry_recorded',
        entityType: financeEntry.kind,
        entityId: entity?.id,
        metadata: {
          kind: financeEntry.kind,
          vendorId: created.vendor?.id,
          sourceMessageId: context.originMessageId
        }
      });
      const aiResult = await this.runAIAgent('finance', intake.normalizedText, context, undefined, {
        workflow: 'finance',
        action: 'ledger_entry',
        entityId: entity?.id,
        kind: financeEntry.kind,
        amount: financeEntry.amount,
        currency: financeEntry.currency
      }, {
        financeEntry,
        created
      });

      return [
        `已记录财务条目：${entity?.id ?? 'unknown'}`,
        `类型：${financeEntry.kind}`,
        financeEntry.kind === 'transaction' ? `方向：${financeEntry.direction}` : '',
        `金额：${formatMoney(financeEntry.amount, financeEntry.currency)}`,
        financeEntry.kind === 'invoice' ? `客户：${financeEntry.customerName} / ${financeEntry.status}` : '',
        financeEntry.kind === 'subscription' ? `供应商：${financeEntry.vendorName} / ${financeEntry.interval}` : '',
        financeEntry.kind === 'transaction' && financeEntry.counterparty ? `对象：${financeEntry.counterparty}` : '',
        aiResult ? '' : '',
        aiResult ? this.renderAIAgentResult(aiResult) : '',
        '',
        '发送 `/finance` 查看财务看板。'
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (isFinanceDashboardRequest(intake.normalizedText)) {
      return this.financeDashboard();
    }

    const calendarEntry = parseCalendarInstruction(intake.normalizedText);
    if (calendarEntry) {
      const created = await this.repos.createCalendarEntry({
        ...calendarEntry,
        sourceMessageId: context.originMessageId,
        createdByUserId: context.userId
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'calendar_event_recorded',
        entityType: 'calendar_event',
        entityId: created.event.id,
        metadata: {
          prepNoteId: created.prepNote?.id,
          sourceMessageId: context.originMessageId
        }
      });
      const aiResult = await this.runAIAgent('calendar', intake.normalizedText, context, undefined, {
        workflow: 'calendar',
        action: 'event_capture',
        eventId: created.event.id,
        prepNoteId: created.prepNote?.id
      }, {
        calendarEntry,
        created: {
          event: created.event,
          prepNote: created.prepNote
        }
      });

      return [
        `已记录日程：${created.event.id}`,
        `标题：${created.event.title}`,
        `时间：${formatDateTime(created.event.starts_at)} - ${formatTime(created.event.ends_at)}`,
        created.event.attendees.length ? `参会人：${created.event.attendees.join(', ')}` : '',
        created.event.location ? `地点：${created.event.location}` : '',
        created.prepNote ? `会议准备：${created.prepNote.id}` : '',
        aiResult ? '' : '',
        aiResult ? this.renderAIAgentResult(aiResult) : '',
        '',
        '发送 `/calendar` 查看日历看板。'
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (isCalendarDashboardRequest(intake.normalizedText)) {
      return this.calendarDashboard();
    }

    const browserInstruction = parseBrowserInstruction(intake.normalizedText);
    if (browserInstruction) {
      const shouldQueueBrowserRun = browserInstruction.isAllowedDomain && browserInstruction.blockedActions.length === 0;
      const browserTask = shouldQueueBrowserRun
        ? await this.repos.createTask({
            title: `浏览器巡检：${browserInstruction.targetDomain}`,
            description: browserInstruction.goal,
            originMessageId: context.originMessageId,
            ownerAgent: 'browser',
            riskLevel: 'low',
            status: 'planned',
            planningMetadata: {
              source: 'browser_automation_v1',
              targetUrl: browserInstruction.targetUrl,
              targetDomain: browserInstruction.targetDomain,
              requestedActions: browserInstruction.requestedActions
            }
          })
        : null;
      const created = await this.repos.createBrowserRun({
        ...browserInstruction,
        taskId: browserTask?.id,
        sourceMessageId: context.originMessageId,
        createdByUserId: context.userId
      });
      const approvalTarget = created.blockedActions.find((action) => typeof action.metadata.approvalAction === 'string');
      let approvalId: string | undefined;
      if (approvalTarget) {
        const approvalAction = approvalTarget.metadata.approvalAction as string;
        const approval = await this.repos.createApproval({
          actionType: approvalAction,
          riskLevel: 'high',
          prompt: `浏览器动作等待审批：${approvalTarget.action_type}`,
          payload: {
            source: 'browser_automation_v1',
            runId: created.run.id,
            taskId: browserTask?.id,
            blockedActionId: approvalTarget.id,
            targetUrl: browserInstruction.targetUrl,
            targetDomain: browserInstruction.targetDomain,
            reason: approvalTarget.reason,
            goal: browserInstruction.goal
          }
        });
        approvalId = approval.id;
        await this.repos.updateBrowserBlockedActionApproval(approvalTarget.id, approval.id);
        await this.repos.audit({
          actorType: 'system',
          action: 'approval_requested',
          entityType: 'approval',
          entityId: approval.id,
          metadata: {
            runId: created.run.id,
            blockedActionId: approvalTarget.id
          }
        });
      }

      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'browser_run_recorded',
        entityType: 'browser_run',
        entityId: created.run.id,
        metadata: {
          targetDomain: browserInstruction.targetDomain,
          status: created.run.status,
          taskId: browserTask?.id,
          blockedActionIds: created.blockedActions.map((action) => action.id),
          approvalId,
          sourceMessageId: context.originMessageId
        }
      });

      const enqueueResult = browserTask
        ? await this.enqueueTask(browserTask.id, {
            taskId: browserTask.id,
            source: 'intake'
          })
        : null;
      const aiResult = await this.runAIAgent('browser', intake.normalizedText, context, browserTask?.id, {
        workflow: 'browser',
        action: 'browser_run',
        runId: created.run.id,
        taskId: browserTask?.id,
        status: created.run.status,
        approvalId
      }, {
        browserInstruction,
        created: {
          run: created.run,
          steps: created.steps,
          screenshot: created.screenshot,
          extraction: created.extraction,
          blockedActions: created.blockedActions
        }
      });

      return [
        `已记录浏览器运行：${created.run.id}`,
        browserTask ? `执行任务：${browserTask.id} / ${enqueueResult?.queued ? 'queued' : 'planned'}` : '',
        `目标：${created.run.goal}`,
        `URL：${created.run.target_url}`,
        `状态：${created.run.status}`,
        browserInstruction.isAllowedDomain ? '' : `已拦截：域名 ${browserInstruction.targetDomain} 不在 allowlist 中`,
        created.screenshot ? `截图证据：${created.screenshot.id} / ${created.screenshot.status}` : '',
        created.extraction ? `提取任务：${created.extraction.id} / ${created.extraction.status}` : '',
        created.blockedActions.length ? `被拦截动作：${created.blockedActions.map((action) => `${action.id}:${action.action_type}`).join(', ')}` : '',
        approvalId ? `审批 ID：${approvalId}` : '',
        '',
        approvalId
          ? `发送 \`/approve ${approvalId}\` 批准该浏览器动作，或发送 \`/reject ${approvalId}\` 拒绝。`
          : browserTask
            ? '低风险只读巡检已进入 worker；runner 会生成本地 evidence JSON，真实 Playwright 截图仍在后续接入。'
            : '当前浏览器请求已记录；被拦截或高风险动作不会自动执行。',
        aiResult ? '' : '',
        aiResult ? this.renderAIAgentResult(aiResult) : '',
        '发送 `/browser` 查看浏览器看板。'
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (isBrowserDashboardRequest(intake.normalizedText)) {
      return this.browserDashboard();
    }

    const plan = structuredPlan;

    if (intake.kind === 'task' && !plan && isContentCreationRequest(intake.normalizedText) && !requiresApproval(intake)) {
      return this.createContentWorkflow(intake.normalizedText, context);
    }

    if (!chiefIntent && intake.kind === 'question') {
      return this.handleChiefQuestion(intake.normalizedText, context);
    }

    const draftContext = plan ? null : await this.loadDraftContext();
    const draft = draftContext ? this.createDraftIfUseful(intake.normalizedText, draftContext) : null;
    const task = await this.repos.createTask({
      title: intake.title,
      description: intake.normalizedText,
      originMessageId: context.originMessageId,
      riskLevel: intake.riskLevel,
      status: plan ? 'planned' : requiresApproval(intake) ? 'waiting_approval' : 'planned',
      planningMetadata: plan
        ? {
            planner: 'v1',
            workflow: workflowFromPlan(plan),
            goal: plan.goal,
            reasons: plan.reasons
          }
        : draft
          ? {
              v3: true,
              draft: draft.text,
              appliedMemories: draft.appliedMemories,
              constraints: draft.constraints
            }
          : undefined
    });

    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'task_created_from_message',
      entityType: 'task',
      entityId: task.id,
      metadata: { intake }
    });

    if (plan) {
      return this.createPlannedTaskResponse(task, plan, context);
    }

    if (requiresApproval(intake)) {
      const approval = await this.repos.createApproval({
        taskId: task.id,
        actionType: intake.requiredApprovalAction ?? 'external_action',
        riskLevel: 'high',
        prompt: approvalPromptFor(intake),
        payload: {
          draft: draft?.text ?? null,
          appliedMemories: draft?.appliedMemories ?? [],
          constraints: draft?.constraints ?? {},
          originalText: intake.normalizedText,
          reasons: intake.reasons
        }
      });
      await this.repos.audit({
        actorType: 'system',
        action: 'approval_requested',
        entityType: 'approval',
        entityId: approval.id,
        metadata: { taskId: task.id }
      });

      return [
        `已创建任务：${task.id}`,
        `状态：waiting_approval`,
        '',
        draft ? `草稿：\n${draft.text}\n` : '',
        draft?.appliedMemories.length
          ? `已应用记忆：${draft.appliedMemories.map((memory) => memory.id).join(', ')}`
          : '',
        `检测到高风险动作：${intake.requiredApprovalAction}`,
        `审批 ID：${approval.id}`,
        '',
        `发送 \`/approve ${approval.id}\` 批准，或发送 \`/reject ${approval.id}\` 拒绝。`
      ]
        .filter(Boolean)
        .join('\n');
    }

    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'intake'
    });

    return [
      `已创建任务：${task.id}`,
      enqueueResult.queued ? `状态：queued` : `状态：planned`,
      '',
      draft ? `草稿：\n${draft.text}\n` : '',
      draft?.appliedMemories.length
        ? `已应用记忆：${draft.appliedMemories.map((memory) => memory.id).join(', ')}`
        : '',
      draft ? '' : '',
      enqueueResult.queued
        ? `已纳入任务队列${enqueueResult.jobId ? `：${enqueueResult.jobId}` : '。'}`
        : '任务已保存，但队列暂时不可用；稍后可以重试。'
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  private async createPlannedTaskResponse(parentTask: TaskRecord, plan: TaskPlan, context: BrainContext) {
    const subtasks: TaskRecord[] = [];
    const approvals: string[] = [];
    let previousTask: TaskRecord | null = null;

    for (const [index, step] of plan.steps.entries()) {
      const stepIntake = intakeMessage(step.title);
      const stepRequiresApproval = stepIntake.kind === 'task' && requiresApproval(stepIntake);
      const subtask = await this.repos.createTask({
        title: step.title,
        description: step.description,
        originMessageId: parentTask.origin_message_id ?? context.originMessageId,
        parentTaskId: parentTask.id,
        ownerAgent: step.ownerAgent,
        riskLevel: stepIntake.riskLevel,
        status: stepRequiresApproval ? 'waiting_approval' : 'planned',
        sequence: index + 1,
        planningMetadata: {
          planner: 'v1',
          workflow: workflowFromPlan(plan),
          parentGoal: plan.goal,
          planReasons: plan.reasons
        }
      });
      subtasks.push(subtask);

      if (previousTask) {
        await this.repos.createTaskDependency({
          taskId: subtask.id,
          dependsOnTaskId: previousTask.id,
          dependencyType: 'sequence',
          metadata: {
            planner: 'v1',
            parentTaskId: parentTask.id
          }
        });
      }
      previousTask = subtask;

      if (stepRequiresApproval) {
        const approval = await this.repos.createApproval({
          taskId: subtask.id,
          actionType: stepIntake.requiredApprovalAction ?? 'external_action',
          riskLevel: 'high',
          prompt: approvalPromptFor(stepIntake),
          payload: {
            parentTaskId: parentTask.id,
            plannedStep: step,
            originalText: step.title,
            reasons: stepIntake.reasons
          }
        });
        approvals.push(approval.id);
      }
    }

    await this.repos.audit({
      actorType: 'system',
      action: 'task_plan_created',
      entityType: 'task',
      entityId: parentTask.id,
      metadata: {
        goal: plan.goal,
        reasons: plan.reasons,
        subtaskIds: subtasks.map((task) => task.id),
        approvalIds: approvals
      }
    });

    const firstOpenSubtask = subtasks.find((subtask) => !['done', 'cancelled'].includes(subtask.status));
    const firstExecutable = firstOpenSubtask?.status === 'planned' ? firstOpenSubtask : null;
    const enqueueResult = firstExecutable
      ? await this.enqueueTask(firstExecutable.id, {
          taskId: firstExecutable.id,
          source: 'intake'
        })
      : null;

    return [
      `已拆解任务：${parentTask.id}`,
      `目标：${plan.goal}`,
      firstExecutable
        ? `当前步骤：${firstExecutable.sequence ?? 1}. ${firstExecutable.title}`
        : '当前步骤：等待审批或补充信息',
      enqueueResult?.queued ? `已启动第一步：queued` : firstExecutable ? '第一步已规划，队列暂不可用' : '',
      '',
      '子任务：',
      ...subtasks.map(
        (subtask, index) =>
          `${index + 1}. ${subtask.id} [${subtask.status}] ${subtask.title}\n   owner:${subtask.owner_agent} / risk:${subtask.risk_level}`
      ),
      approvals.length ? '' : '',
      approvals.length ? `待审批子任务：${approvals.join(', ')}` : '',
      '',
      `发送 \`/task ${parentTask.id}\` 查看拆解结果。`
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async handleContinuation(text: string, context: BrainContext) {
    const recent = await this.repos.listRecentMessagesForChat(context.chatId, 30);
    const priorMessages = recent.filter((message) => message.id !== context.originMessageId && Boolean(message.text));
    const prompt = priorMessages.find((message) => message.direction === 'outbound' && isContinuationPrompt(message.text ?? ''));
    if (!prompt?.text) return this.continueLatestExecutableTask(text, context, 'short_confirmation_without_prompt');

    if (requiresExplicitApprovalContinuation(prompt.text)) {
      return [
        '我接上上一条了，但那条涉及审批或高风险动作，不能只用“继续”代替确认。',
        '',
        '请用明确命令处理：',
        '- `/approve apv_xxx` 批准',
        '- `/reject apv_xxx` 拒绝'
      ].join('\n');
    }

    const task = await this.resolveContinuationTask(prompt.text);
    if (task) {
      return this.launchContinuationTask(task, text, context, {
        promptMessageId: prompt.id,
        mode: 'prompt_task'
      });
    }

    const reconstructedText = buildContinuationText(text, prompt.text, priorMessages);
    const routingHandoff = await this.runRoutingHandoff(reconstructedText, context);
    const aiResult = await this.runAIAgent('chief_of_staff', reconstructedText, context, undefined, {
      workflow: 'continuation_context',
      confirmationText: text,
      promptMessageId: prompt.id,
      handoffRunIds: routingHandoff.map((result) => result.runId)
    }, {
      continuation: {
        confirmationText: text,
        prompt: prompt.text,
        recentMessages: priorMessages.slice(0, 8).reverse()
      },
      routingHandoff: routingHandoff.map(toHandoffContext)
    });

    if (!aiResult) {
      return [
        '我接上上一条了，但没有找到可自动启动的任务。',
        '',
        '你可以发 `/tasks` 看当前 planned 任务，或直接发 `/retry tsk_xxx` 推进某个任务。'
      ].join('\n');
    }

    return [
      '已按上一条上下文继续处理。',
      '',
      this.renderAIAgentHandoff(routingHandoff),
      '',
      this.renderAIAgentResult(aiResult)
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  private async handleChiefQuestion(
    text: string,
    context: BrainContext,
    extraContext: Record<string, unknown> = {}
  ) {
    const routingHandoff = await this.runRoutingHandoff(text, context);
    const aiResult = await this.runAIAgent('chief_of_staff', text, context, undefined, {
      workflow: 'chief_question',
      handoffRunIds: routingHandoff.map((result) => result.runId)
    }, {
      ...extraContext,
      routingHandoff: routingHandoff.map(toHandoffContext)
    });
    if (aiResult) {
      const specialistHandoff = await this.runSpecialistHandoffFromChief(
        text,
        context,
        routingHandoff,
        aiResult
      );
      return [
        this.renderAIAgentHandoff(routingHandoff),
        '',
        this.renderAIAgentResult(aiResult),
        specialistHandoff ? '' : '',
        specialistHandoff ? this.renderSpecialistHandoffExecution(specialistHandoff) : ''
      ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
    }

    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'question_answered',
      metadata: { text }
    });
    return [
      '我已收到，这是一个咨询类请求。',
      '',
      '当前 V3 Agent OS 会优先用 AI Agent 做判断；这次模型运行失败，已回退为安全答复。',
      '',
      '如果你希望我把它作为任务跟进，可以说：`帮我把这件事建成任务`。'
    ].join('\n');
  }

  private async classifyChiefIntent(intake: ReturnType<typeof intakeMessage>, context: BrainContext) {
    if (!this.agentRunner || !shouldAskChiefIntentAI(intake)) return null;

    try {
      const runtimeState = await this.loadAIAgentRuntimeState(context);
      const result = await this.agentRunner.run({
        agentId: 'chief_of_staff',
        systemPrompt: systemPromptForAgent('chief_of_staff'),
        userText: buildChiefIntentPrompt(intake),
        context: {
          telegramUserId: context.telegramUserId,
          userId: context.userId,
          chatId: context.chatId,
          originMessageId: context.originMessageId,
          runtimeState
        },
        tools: [],
        maxToolRounds: 0,
        metadata: {
          source: 'telegram',
          sourceMessageId: context.originMessageId,
          workflow: 'chief_intent_classification'
        }
      });
      const decision = parseChiefIntentDecision(result.content);
      await this.repos.audit({
        actorType: 'system',
        action: 'chief_intent_classified',
        entityType: 'agent_run',
        entityId: result.runId,
        metadata: {
          route: decision?.route,
          confidence: decision?.confidence,
          reason: decision?.reason,
          targetWorkflow: decision?.targetWorkflow,
          text: intake.normalizedText
        }
      });
      if (!decision || decision.confidence < 0.55 || decision.route === 'unknown') return null;
      return decision;
    } catch (error) {
      await this.repos.audit({
        actorType: 'system',
        action: 'chief_intent_classification_failed',
        entityType: 'message',
        entityId: context.originMessageId,
        metadata: {
          text: intake.normalizedText,
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      return null;
    }
  }

  private async handleProgressNudge(text: string, context: BrainContext) {
    const runningRuns = latestRunsByStatus(await this.repos.listAgentRuns(10), 'running');
    if (runningRuns.length) {
      return [
        '我看到了，上一轮 Agent 还在执行，不需要重新创建任务。',
        '',
        '正在运行：',
        ...runningRuns.slice(0, 3).map((run, index) => `- ${renderLinkedAgentRun(run, index + 1)}`),
        '',
        `可以发送 \`/trace ${runningRuns[0].id}\` 查看当前 run，完成后我会把结果发回 Telegram。`
      ].join('\n');
    }

    const activeTasks = await this.repos.listTasksByStatuses(['running', 'queued'], 10);
    const realActiveTasks = activeTasks.filter((task) => !isNudgeOnlyTask(task));
    if (realActiveTasks.length) {
      return [
        '我看到了，当前已经有任务在队列或执行中，不会再新建一个“推进”任务。',
        '',
        '当前任务：',
        ...realActiveTasks.slice(0, 5).map((task) => `- ${task.id} [${task.status}] ${task.title}\n  owner:${task.owner_agent}`),
        '',
        `发送 \`/task ${realActiveTasks[0].id}\` 查看详情。`
      ].join('\n');
    }

    return this.continueLatestExecutableTask(text, context, 'progress_nudge');
  }

  private async continueLatestExecutableTask(text: string, context: BrainContext, mode: string) {
    const task = await this.resolveLatestExecutableTask();
    if (task) {
      return this.launchContinuationTask(task, text, context, { mode });
    }

    return [
      '我接到你的推进信号了，但没有找到正在运行或可继续的任务。',
      '',
      '你可以发送 `/tasks` 看当前任务，或发送 `/retry tsk_xxx` 指定推进某个任务。'
    ].join('\n');
  }

  private async launchContinuationTask(
    task: TaskRecord,
    text: string,
    context: BrainContext,
    params: { promptMessageId?: string; mode: string }
  ) {
    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'retry'
    });
    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'continuation_confirmed',
      entityType: 'task',
      entityId: task.id,
      metadata: {
        confirmationText: text,
        promptMessageId: params.promptMessageId,
        sourceMessageId: context.originMessageId,
        mode: params.mode,
        jobId: enqueueResult.jobId
      }
    });

    return [
      params.promptMessageId ? '已接上上一条上下文，开始继续执行。' : '已找到最近可继续的任务，开始推进。',
      '',
      `启动任务：${task.id}`,
      `标题：${task.title}`,
      `owner：${task.owner_agent}`,
      `状态：${enqueueResult.queued ? 'queued' : 'planned'}`,
      enqueueResult.jobId ? `队列 Job：${enqueueResult.jobId}` : '',
      '',
      `发送 \`/task ${task.id}\` 查看状态，或发送 \`/tasks\` 看任务列表。`
    ].filter(Boolean).join('\n');
  }

  private async resolveContinuationTask(promptText: string) {
    const explicitTask = await this.resolveTaskFromPromptIds(promptText);
    if (explicitTask) return explicitTask;

    const planned = await this.repos.listTasksByStatuses(['planned', 'failed', 'blocked', 'waiting_external'], 50);
    const ownerPreference = continuationOwnerPreference(promptText);
    for (const owner of ownerPreference) {
      const match = planned.find((task) => task.owner_agent === owner);
      if (match) return this.selectExecutableTask(match);
    }

    const firstWorkflowTask = planned.find((task) => task.parent_task_id && task.sequence === 1) ?? planned.find((task) => task.parent_task_id);
    return firstWorkflowTask ? this.selectExecutableTask(firstWorkflowTask) : null;
  }

  private async resolveLatestExecutableTask() {
    const planned = await this.repos.listTasksByStatuses(['planned', 'failed', 'blocked', 'waiting_external'], 50);
    for (const task of planned.filter((item) => !isNudgeOnlyTask(item))) {
      const executable = await this.selectExecutableTask(task);
      if (executable && !isNudgeOnlyTask(executable)) return executable;
    }
    return null;
  }

  private async resolveTaskFromPromptIds(promptText: string) {
    const taskIds = [...new Set([...promptText.matchAll(/tsk_[a-z0-9-]+/gi)].map((match) => match[0]))];
    for (const taskId of taskIds) {
      const task = await this.repos.getTask(taskId);
      const executable = task ? await this.selectExecutableTask(task) : null;
      if (executable) return executable;
    }
    return null;
  }

  private async selectExecutableTask(task: TaskRecord) {
    const resolved = await this.resolveExecutableForRequestedTask(task);
    return resolved.executable;
  }

  private async resolveExecutableForRequestedTask(task: TaskRecord): Promise<{
    executable: TaskRecord | null;
    blockedBy: TaskRecord | null;
  }> {
    if (task.parent_task_id) {
      const blocker = await this.findPreviousIncompleteSubtask(task);
      if (blocker) return { executable: null, blockedBy: blocker };
      return {
        executable: isRetryableTaskStatus(task.status) ? task : null,
        blockedBy: null
      };
    }

    const subtasks = await this.repos.listSubtasks(task.id);
    if (!subtasks.length) {
      return {
        executable: isRetryableTaskStatus(task.status) ? task : null,
        blockedBy: null
      };
    }

    const ordered = subtasks
      .slice()
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.created_at.localeCompare(b.created_at));

    for (const subtask of ordered) {
      if (['done', 'cancelled'].includes(subtask.status)) continue;
      if (isRetryableTaskStatus(subtask.status)) {
        return { executable: subtask, blockedBy: null };
      }
      return { executable: null, blockedBy: subtask };
    }

    return {
      executable: isRetryableTaskStatus(task.status) ? task : null,
      blockedBy: null
    };
  }

  private async findPreviousIncompleteSubtask(task: TaskRecord) {
    if (!task.parent_task_id || !task.sequence || task.sequence <= 1) return null;
    const siblings = await this.repos.listSubtasks(task.parent_task_id);
    return siblings
      .filter((sibling) => (sibling.sequence ?? 0) < task.sequence!)
      .find((sibling) => !['done', 'cancelled'].includes(sibling.status)) ?? null;
  }

  private async enqueueTask(taskId: string, data: TaskJobData) {
    try {
      const enqueued = await this.taskDispatcher.enqueueTask(data);
      await this.repos.updateTaskStatus(
        taskId,
        'queued',
        enqueued.jobId ? `Queued as job ${enqueued.jobId}` : 'Queued for worker'
      );
      await this.repos.audit({
        actorType: 'system',
        action: 'task_enqueued',
        entityType: 'task',
        entityId: taskId,
        metadata: {
          ...data,
          jobId: enqueued.jobId
        }
      });
      return { queued: true, jobId: enqueued.jobId };
    } catch (error) {
      await this.repos.updateTaskStatus(taskId, 'planned', 'Queue unavailable; task saved for retry');
      await this.repos.audit({
        actorType: 'system',
        action: 'task_enqueue_failed',
        entityType: 'task',
        entityId: taskId,
        metadata: {
          ...data,
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      return { queued: false, jobId: undefined };
    }
  }

  private async runRoutingHandoff(text: string, context: BrainContext) {
    if (!this.agentRunner) return [];

    const domainRouter = await this.runAIAgent('domain_router', text, context, undefined, {
      workflow: 'routing_handoff',
      handoffStage: 'domain_router'
    });
    const skillRouter = await this.runAIAgent('skill_router', text, context, undefined, {
      workflow: 'routing_handoff',
      handoffStage: 'skill_router',
      upstreamRunId: domainRouter?.runId
    }, {
      upstreamHandoff: domainRouter ? toHandoffContext(domainRouter) : null
    });

    return [domainRouter, skillRouter].filter((result): result is AgentRunResult => Boolean(result));
  }

  private async runSpecialistHandoffFromChief(
    text: string,
    context: BrainContext,
    routingHandoff: AgentRunResult[],
    chiefResult: AgentRunResult
  ): Promise<SpecialistHandoffExecution | null> {
    const plan = specialistHandoffPlanFromChiefRun(chiefResult);
    if (!plan?.agents.length) return null;

    const task = await this.createV3WorkflowTask({
      workflow: 'specialist_handoff',
      title: `V3 Specialist Handoff：${text.slice(0, 60)}`,
      description: text,
      ownerAgent: 'chief_of_staff',
      riskLevel: 'low',
      context,
      metadata: {
        goal: plan.goal,
        chiefRunId: chiefResult.runId,
        routingRunIds: routingHandoff.map((result) => result.runId),
        sourceToolCallId: plan.sourceToolCallId,
        executionMode: plan.executionMode,
        specialistAgents: plan.agents.map((agent) => agent.agentId)
      },
      dependencyMode: plan.executionMode,
      steps: plan.agents.map((agent) => ({
        title: `${getAgentDefinition(agent.agentId).displayName} handoff`,
        ownerAgent: agent.agentId,
        description: agent.reason || agent.role || getAgentDefinition(agent.agentId).role
      }))
    });

    const upstreamHandoff = [...routingHandoff.map(toHandoffContext), toHandoffContext(chiefResult)];
    const runAgent = (agent: SpecialistHandoffPlan['agents'][number], index: number) => this.runAIAgentWithAttempts(
      agent.agentId,
      text,
      context,
      task.id,
      {
        workflow: 'specialist_handoff',
        handoffStage: 'specialist',
        handoffRootRunId: chiefResult.runId,
        handoffRunIds: upstreamHandoff.map((result) => result.runId),
        specialistExecutionMode: plan.executionMode,
        specialistIndex: index + 1,
        specialistCount: plan.agents.length,
        sourceToolCallId: plan.sourceToolCallId
      },
      {
        chiefHandoffPlan: plan,
        upstreamHandoff,
        specialistAgent: agent
      },
      2
    );

    const results: SpecialistHandoffExecution['results'] = [];
    if (plan.executionMode === 'sequence') {
      for (const [index, agent] of plan.agents.entries()) {
        results.push(await runAgent(agent, index));
      }
    } else {
      results.push(...await Promise.all(plan.agents.map((agent, index) => runAgent(agent, index))));
    }

    const specialistRunIds = results
      .map((item) => item.result?.runId)
      .filter((runId): runId is string => Boolean(runId));
    await this.repos.updateAgentRun(chiefResult.runId, {
      status: 'done',
      metadata: {
        specialistHandoffTaskId: task.id,
        specialistRunIds,
        specialistAgents: plan.agents.map((agent) => agent.agentId),
        specialistExecutionMode: plan.executionMode,
        partialResultCount: specialistRunIds.length,
        specialistFailureCount: results.length - specialistRunIds.length
      }
    });
    await this.repos.audit({
      actorType: 'system',
      action: 'specialist_handoff_completed',
      entityType: 'task',
      entityId: task.id,
      metadata: {
        chiefRunId: chiefResult.runId,
        executionMode: plan.executionMode,
        specialistRunIds,
        specialistAgents: plan.agents.map((agent) => agent.agentId),
        completedCount: specialistRunIds.length,
        totalCount: results.length
      }
    });

    return {
      task,
      plan,
      chiefRunId: chiefResult.runId,
      results
    };
  }

  private async runAIAgentWithAttempts(
    agentId: string,
    text: string,
    context: BrainContext,
    taskId: string | undefined,
    metadata: Record<string, unknown>,
    agentContext: Record<string, unknown>,
    maxAttempts: number
  ) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await this.runAIAgent(agentId, text, context, taskId, {
        ...metadata,
        attempt,
        maxAttempts
      }, agentContext);
      if (result) {
        return {
          agentId,
          result,
          attempts: attempt
        };
      }
    }

    await this.repos.audit({
      actorType: 'system',
      action: 'specialist_agent_failed_after_retry',
      entityType: taskId ? 'task' : 'message',
      entityId: taskId ?? context.originMessageId,
      metadata: {
        agentId,
        maxAttempts
      }
    });
    return {
      agentId,
      result: null,
      attempts: maxAttempts
    };
  }

  private renderSpecialistHandoffExecution(execution: SpecialistHandoffExecution) {
    const completedCount = execution.results.filter((item) => item.result).length;
    return [
      `Specialist Handoff：已${execution.plan.executionMode === 'parallel' ? '并行' : '串行'}执行 ${completedCount}/${execution.results.length}`,
      `任务：${execution.task.id}`,
      `Chief Run：${execution.chiefRunId}`,
      `专家：${execution.plan.agents.map((agent) => agent.agentId).join(', ')}`,
      execution.plan.reason ? `原因：${execution.plan.reason}` : '',
      '',
      ...execution.results.map((item) => {
        if (!item.result) {
          return `- ${item.agentId} -> failed after ${item.attempts} attempts`;
        }
        const preview = firstLine(item.result.content).slice(0, 180);
        const tools = item.result.toolCalls.length
          ? ` tools:${item.result.toolCalls.map((tool) => `${tool.name}:${tool.status}`).join(',')}`
          : '';
        return `- ${item.agentId} -> ${item.result.runId} attempts:${item.attempts}${tools}${preview ? `\n  ${preview}` : ''}`;
      }),
      '',
      `发送 \`/trace ${execution.chiefRunId}\` 查看完整 handoff 链路，或 \`/task ${execution.task.id}\` 查看子任务。`
    ].filter(Boolean).join('\n');
  }

  private renderAIAgentHandoff(results: AgentRunResult[], label = '已执行预路由') {
    if (!results.length) {
      return 'AI Agent Handoff：未产生前置 run';
    }

    return [
      `AI Agent Handoff：${label}`,
      ...results.map((result) => {
        const tools = result.toolCalls.length
          ? ` tools:${result.toolCalls.map((tool) => `${tool.name}:${tool.status}`).join(',')}`
          : '';
        const preview = firstLine(result.content).slice(0, 160);
        return `- ${result.agentId} -> ${result.runId}${tools}${preview ? `\n  ${preview}` : ''}`;
      })
    ].join('\n');
  }

  private async runAIAgent(
    agentId: string,
    text: string,
    context: BrainContext,
    taskId?: string,
    metadata: Record<string, unknown> = {},
    agentContext: Record<string, unknown> = {}
  ) {
    if (!this.agentRunner) return null;

    try {
      const contextPack = await buildContextPack(this.repos, {
        requestId: `ctx_${taskId ?? context.originMessageId}`,
        querySummary: text,
        chatId: context.chatId
      });
      const runtimeState = contextPackForAgentRuntime(contextPack);
      const result = await this.agentRunner.run({
        agentId,
        systemPrompt: systemPromptForAgent(agentId),
        userText: text,
        taskId,
        context: {
          telegramUserId: context.telegramUserId,
          userId: context.userId,
          chatId: context.chatId,
          originMessageId: context.originMessageId,
          ...agentContext,
          contextPack: runtimeState,
          runtimeState: runtimeState.runtimeState
        },
        tools: buildCoreAgentTools(this.repos, { chatId: context.chatId }),
        metadata: {
          source: 'telegram',
          sourceMessageId: context.originMessageId,
          ...metadata
        }
      });
      await this.repos.audit({
        actorType: 'system',
        action: 'ai_agent_run_completed',
        entityType: 'agent_run',
        entityId: result.runId,
        metadata: {
          agentId,
          taskId,
          provider: result.provider,
          model: result.model,
          toolCallCount: result.toolCalls.length
        }
      });
      return result;
    } catch (error) {
      await this.repos.audit({
        actorType: 'system',
        action: 'ai_agent_run_failed',
        entityType: taskId ? 'task' : 'message',
        entityId: taskId ?? context.originMessageId,
        metadata: {
          agentId,
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      return null;
    }
  }

  private async loadAIAgentRuntimeState(context: BrainContext) {
    const errors: string[] = [];
    const [recentTasksResult, activeTasksResult, recentMessagesResult, pendingApprovalsResult] = await Promise.allSettled([
      this.repos.listTasks(10),
      this.repos.listTasksByStatuses(ACTIVE_CONTEXT_TASK_STATUSES, 10),
      this.repos.listRecentMessagesForChat(context.chatId, 10),
      this.repos.listPendingApprovals(10)
    ]);

    const recentTasks = settledArray(recentTasksResult, 'recentTasks', errors);
    const activeTasks = settledArray(activeTasksResult, 'activeTasks', errors);
    const recentMessages = settledArray(recentMessagesResult, 'recentMessages', errors);
    const pendingApprovals = settledArray(pendingApprovalsResult, 'pendingApprovals', errors);

    return {
      notice: 'Company memories are long-term knowledge only. Empty strategic/operational/playbook memory does not mean there are no tasks, no recent chat messages, or no execution signal.',
      chatId: context.chatId,
      recentTasks: recentTasks.map(compactRuntimeTask),
      activeTasks: activeTasks.map(compactRuntimeTask),
      recentMessages: recentMessages.map(compactRuntimeMessage),
      pendingApprovals: pendingApprovals.map(compactRuntimeApproval),
      loadErrors: errors
    };
  }

  private renderAIAgentResult(result: AgentRunResult) {
    return [
      'AI Agent Runtime：已执行真实模型 Agent',
      `Agent：${result.agentId}`,
      `Agent Run：${result.runId}`,
      `模型：${result.provider}/${result.model}`,
      result.toolCalls.length
        ? `工具调用：${result.toolCalls.map((tool) => `${tool.name}:${tool.status}`).join(', ')}`
        : '工具调用：无',
      '',
      renderAgentContentForTelegram(result.content)
    ].join('\n');
  }

  private async loadDraftContext() {
    const [preferences, playbooks] = await Promise.all([
      this.repos.listMemories({ type: 'preference', limit: 10 }),
      this.repos.listMemories({ type: 'playbook', limit: 5 })
    ]);
    return buildDraftContext([...preferences, ...playbooks]);
  }

  private async handleCommand(commandText: string, context: BrainContext) {
    const match = commandText.match(/^(\S+)(?:\s+([\s\S]+))?$/);
    const command = match?.[1] ?? commandText;
    const arg = match?.[2]?.trim();
    switch (command) {
      case '/start':
        return [
          'Tele-OPC OS V3.2 Agent OS 已连接。',
          '',
          '核心入口：',
          '`/solve <问题>` 多领域方案、风险和执行计划',
          '`/prospect <领域/ICP>` 客户挖掘、线索评分和销售开发计划',
          '`/content <需求>` 内容草稿、活动文案和发布计划',
          '`/industry [skill_id]` 查看行业 Skill',
          '`/agents` 查看 Agent Registry',
          '`/agent <name>` 查看单个 Agent',
          '',
          '经营看板：',
          '`/today` 查看今日控制台',
          '`/crm` 查看客户看板',
          '`/finance` 查看财务看板',
          '`/calendar` 查看日历看板',
          '`/mail` 查看邮件看板',
          '`/browser` 查看浏览器看板',
          '`/ops` 查看运维治理看板',
          '`/retry <task_id>` 重试失败或阻塞任务',
          '`/healthcheck` 检查核心集成状态',
          '`/eval` 运行治理评估套件',
          '`/audit_export [limit]` 导出最近审计日志',
          '`/backup [row_limit]` 创建本地 JSONL 备份',
          '`/settings` 查看配置和写入偏好',
          '`/tasks` 查看任务',
          '`/task <id>` 查看任务详情',
          '`/trace <agent_run_id>` 查看单次 AI Agent 轨迹',
          '`/memory` 查看公司记忆',
          '`/review <task_id> <复盘内容>` 生成任务复盘',
          '',
          'V3 默认自动执行普通分析、客户挖掘、CRM 写入和邮件发送；真实财务动作、付费数据源和生产破坏性操作会进入确认。'
        ].join('\n');
      case '/agents':
        return this.listAgents();
      case '/agent':
        return arg ? this.showAgent(arg) : '请提供 Agent ID，例如：`/agent prospecting`。发送 `/agents` 查看列表。';
      case '/industry':
        return this.industrySkills(arg);
      case '/solve':
        return arg ? this.createSolutionWorkflow(arg, context) : '请提供要分析的问题，例如：`/solve 评估一个深圳轻食外卖项目，预算 10 万，3 个月验证。`';
      case '/prospect':
        return arg ? this.createProspectingWorkflow(arg, context) : '请提供要挖掘的客户领域，例如：`/prospect 深圳 企业数字化转型 50-300 人 有招聘信号`';
      case '/leads':
        return this.listProspectingTasks('leads');
      case '/campaigns':
        return this.listProspectingTasks('campaigns');
      case '/send_campaign':
      case '/send-campaign':
        return arg ? this.sendCampaign(arg, context) : '请提供 Campaign ID，例如：`/send_campaign cmp_xxx`。';
      case '/campaign_event':
      case '/campaign-event':
        return arg ? this.recordCampaignEvent(arg, context) : '请提供事件，例如：`/campaign_event cmp_xxx replied lead_xxx 客户回复感兴趣`。';
      case '/quote':
        return arg ? this.createQuoteWorkflow(arg, context) : '请提供报价需求，例如：`/quote 给 Acme 生成网站维护套餐报价草案`';
      case '/content':
        return arg ? this.createContentWorkflow(arg, context) : '请提供内容需求，例如：`/content 给轻食品牌写 3 条小红书种草文案`';
      case '/kb':
        return this.knowledgeStatus();
      case '/import':
        return this.importKnowledge(arg, context);
      case '/dev':
        return arg ? this.createSpecialistWorkflow('dev', arg, context) : '请提供开发任务，例如：`/dev 修复登录失败，跑测试，不部署生产`';
      case '/runs':
        return this.listAgentRuns();
      case '/trace':
        return arg ? this.showAgentRunTrace(arg) : '请提供 Agent Run ID，例如：`/trace agr_xxx`。发送 `/runs` 查看最近 run。';
      case '/today':
      case '/briefing':
        return this.todayBriefing(context.userId);
      case '/memory':
        return this.listMemories(arg);
      case '/crm':
        return this.crmDashboard();
      case '/finance':
        return this.financeDashboard();
      case '/calendar':
        return this.calendarDashboard();
      case '/mail':
        return this.mailDashboard();
      case '/browser':
        return this.browserDashboard();
      case '/settings':
        return this.settings(arg, context);
      case '/ops':
        return this.opsDashboard(context);
      case '/healthcheck':
      case '/health':
        return this.runHealthChecks(context.userId);
      case '/eval':
      case '/evaluate':
        return this.runEvaluations(context.userId);
      case '/audit_export':
      case '/audit-export':
        return this.exportAuditLogs(arg, context.userId);
      case '/backup':
        return this.createBackup(arg, context.userId);
      case '/review':
        return arg ? this.createReview(arg, context.userId) : '请提供任务 ID 和复盘内容，例如：`/review tsk_xxx 已完成，流程可以复用。`';
      case '/reviews':
        return this.listReviews();
      case '/playbooks':
        return this.listPlaybooks();
      case '/tasks':
        return this.listTasks();
      case '/task':
        return arg ? this.showTask(arg) : '请提供任务 ID，例如：`/task tsk_xxx`';
      case '/retry':
        return arg ? this.retryTask(arg, context.userId) : '请提供任务 ID，例如：`/retry tsk_xxx`';
      case '/approve':
        return arg ? this.decideApproval(arg, 'approved', context.userId) : '请提供审批 ID，例如：`/approve apv_xxx`';
      case '/reject':
        return arg ? this.decideApproval(arg, 'rejected', context.userId) : '请提供审批 ID，例如：`/reject apv_xxx`';
      default:
        return `暂不支持命令：${command}`;
    }
  }

  private listAgents() {
    const agents = listAgentDefinitions();
    return [
      'Agent Registry：',
      '',
      ...agents.map(
        (agent, index) =>
          `${index + 1}. ${agent.id} / ${agent.displayName}\n   ${agent.role}\n   mode:${agent.mode} / capabilities:${agent.capabilities.join(', ')}`
      ),
      '',
      '发送 `/agent <id>` 查看审批边界。'
    ].join('\n');
  }

  private showAgent(agentId: string) {
    const agent = getAgentDefinition(agentId);
    if (agent.id !== agentId && agentId !== 'chief_of_staff') {
      return `没有找到 Agent：${agentId}。发送 /agents 查看可用 Agent。`;
    }
    return [
      `${agent.displayName}`,
      '',
      `ID：${agent.id}`,
      `模式：${agent.mode}`,
      `职责：${agent.role}`,
      '',
      '能力：',
      ...agent.capabilities.map((capability) => `- ${capability}`),
      '',
      '需要确认：',
      ...(agent.approvalRequiredFor.length ? agent.approvalRequiredFor.map((item) => `- ${item}`) : ['- 无'])
    ].join('\n');
  }

  private industrySkills(arg: string | undefined) {
    if (arg) {
      const skill = getSkillDefinition(arg);
      if (!skill) return `没有找到 Skill：${arg}。发送 /industry 查看行业 Skill。`;
      return [
        `${skill.displayName}`,
        '',
        `ID：${skill.id}`,
        `类型：${skill.type}`,
        `状态：${skill.status}`,
        `说明：${skill.summary}`,
        '',
        '触发词：',
        `- ${skill.triggers.join('、')}`,
        '',
        '必要输入：',
        ...skill.requiredInputs.map((item) => `- ${item}`),
        '',
        '输出：',
        ...skill.outputs.map((item) => `- ${item}`),
        '',
        '风险边界：',
        ...skill.riskNotes.map((item) => `- ${item}`)
      ].join('\n');
    }

    const industry = listSkills('industry');
    return [
      '行业 Skill：',
      '',
      ...industry.map((skill, index) => `${index + 1}. ${skill.id} / ${skill.displayName}\n   ${skill.summary}`),
      '',
      '发送 `/industry <skill_id>` 查看详情。'
    ].join('\n');
  }

  private knowledgeStatus() {
    const skills = listSkills();
    const builtIn = skills.filter((skill) => skill.status === 'built_in');
    const drafts = skills.filter((skill) => skill.status === 'draft');
    return [
      '知识与 Skill 状态：',
      '',
      `Skill Registry：${skills.length} 个 Skill`,
      `内置 Skill：${builtIn.length}`,
      `草案 Skill：${drafts.length}`,
      '',
      '当前阶段已支持：',
      '- 行业 Skill 和职能 Skill 查询',
      '- /solve 创建方案任务',
      '- /prospect 创建客户挖掘任务',
      '- 把 Skill 选择写入任务 metadata 和审计日志',
      '',
      '文件导入生成 Skill 草案会在后续 Skill Foundation 阶段接入。'
    ].join('\n');
  }

  private async importKnowledge(arg: string | undefined, context: BrainContext) {
    if (!arg) {
      return [
        'V3 导入入口：',
        '',
        '当前已支持文本价格表导入，例如：',
        '`/import 价格表：网站维护套餐 3000 元/月；企业版 12000 元/年`',
        '',
        '后续会继续接入文件上传解析、行业资料、SOP、合同条款和 Skill 草案生成。'
      ].join('\n');
    }

    const pricingRules = parsePricingRules(arg);
    if (pricingRules.length) {
      const memory = await this.repos.createMemory({
        type: 'pricing',
        content: arg,
        importance: 'high',
        createdByUserId: context.userId,
        source: {
          sourceType: 'telegram_import',
          sourceId: context.originMessageId,
          metadata: {
            telegramUserId: context.telegramUserId,
            chatId: context.chatId
          }
        },
        metadata: {
          source: 'v3_import',
          parsedPricingRules: pricingRules
        }
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: context.userId,
        action: 'pricing_rules_imported',
        entityType: 'memory',
        entityId: memory.id,
        metadata: {
          ruleCount: pricingRules.length,
          sourceMessageId: context.originMessageId
        }
      });

      return [
        renderImportedPricingRules(pricingRules),
        '',
        `Memory：${memory.id}`,
        '类型：pricing',
        '',
        '现在可以发送 `/quote <客户需求>` 生成标准报价草案。'
      ].join('\n');
    }

    return [
      '已收到导入内容，但当前只支持文本价格表解析。',
      '',
      '请使用类似格式：',
      '`/import 价格表：网站维护套餐 3000 元/月；企业版 12000 元/年`',
      '',
      '行业资料、SOP、合同和文件上传解析会在 Skill Foundation 后续阶段接入。'
    ].join('\n');
  }

  private async createSolutionWorkflow(text: string, context: BrainContext) {
    const draft = buildSolutionDraft(text);
    const task = await this.createV3WorkflowTask({
      workflow: 'solution',
      title: `V3 方案任务：${text.slice(0, 60)}`,
      description: text,
      ownerAgent: 'solution',
      riskLevel: 'low',
      context,
      metadata: {
        solutionDraft: draft
      },
      steps: draft.nextAgentTasks
    });
    const run = await this.repos.createSolutionRun({
      taskId: task.id,
      originalText: draft.originalText,
      selectedSkillIds: draft.selectedSkillIds,
      problemStatement: draft.problemStatement,
      assumptions: draft.assumptions,
      evidencePlan: draft.evidencePlan,
      options: draft.options.map((option) => ({ ...option })),
      recommendation: draft.recommendation,
      risks: draft.risks,
      executionPlan: draft.executionPlan.map((bucket) => ({ ...bucket })),
      metadata: {
        sourceMessageId: context.originMessageId,
        workflowTaskId: task.id
      }
    });
    const researchResult = await this.runAIAgent('research', text, context, task.id, {
      workflow: 'solution',
      handoffStage: 'research',
      selectedSkillIds: draft.selectedSkillIds
    }, {
      solutionDraft: draft,
      evidencePlan: draft.evidencePlan
    });
    const aiResult = await this.runAIAgent('solution', text, context, task.id, {
      workflow: 'solution',
      selectedSkillIds: draft.selectedSkillIds,
      upstreamRunId: researchResult?.runId
    }, {
      researchHandoff: researchResult ? toHandoffContext(researchResult) : null,
      solutionDraft: draft
    });
    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'intake'
    });

    return [
      renderSolutionDraft(draft),
      '',
      `任务：${task.id}`,
      `Solution Run：${run.id}`,
      enqueueResult.queued ? `状态：queued` : '状态：planned',
      researchResult ? '' : '',
      researchResult ? this.renderAIAgentHandoff([researchResult], '已执行 Research 前置 run') : '',
      aiResult ? '' : '',
      aiResult ? this.renderAIAgentResult(aiResult) : '',
      '',
      `发送 \`/task ${task.id}\` 查看子任务和 Skill trace。`
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  private async createQuoteWorkflow(text: string, context: BrainContext) {
    const pricingMemories = await this.repos.listMemories({ type: 'pricing', limit: 20 });
    const draft = buildQuoteDraft(text, pricingMemories);
    const task = await this.createV3WorkflowTask({
      workflow: 'quote',
      title: `V3 报价任务：${text.slice(0, 60)}`,
      description: text,
      ownerAgent: 'quote',
      riskLevel: 'medium',
      context,
      metadata: {
        originalText: text,
        quoteDraft: draft,
        policy: '标准报价草案自动生成；正式开票、付款、超折扣和合同金额承诺需要确认。'
      },
      steps: [
        { title: '检索报价规则和服务包', ownerAgent: 'quote', description: '查找 pricing memory、服务包、折扣规则和合同条款。' },
        { title: '生成报价草案和风险提示', ownerAgent: 'quote', description: '生成价格依据、适用规则、折扣边界和异常升级点。' },
        { title: '准备报价邮件草稿', ownerAgent: 'email', description: '只生成草稿，不默认外发。' }
      ]
    });
    const artifact = await this.createQuoteMarkdownArtifact(task.id, draft);
    const aiResult = await this.runAIAgent('quote', text, context, task.id, {
      workflow: 'quote',
      pricingRuleCount: draft.pricingRuleCount,
      matchedRuleCount: draft.matchedRules.length,
      subtotal: draft.subtotal
    });
    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'intake'
    });

    return [
      renderQuoteDraft(draft),
      '',
      `任务：${task.id}`,
      `报价文档：${artifact.id} / ${artifact.uri ?? 'content-only'}`,
      enqueueResult.queued ? '状态：queued' : '状态：planned',
      aiResult ? '' : '',
      aiResult ? this.renderAIAgentResult(aiResult) : '',
      '',
      '注意：这只是报价草案，不会自动开票、收款、发送邮件或形成财务承诺。',
      `发送 \`/task ${task.id}\` 查看报价子任务。`
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  private async createQuoteMarkdownArtifact(taskId: string, draft: QuoteDraft) {
    const artifact = await this.repos.createArtifact({
      taskId,
      type: 'quote_markdown',
      title: `报价文档草案：${draft.originalText.slice(0, 60)}`,
      uri: `tele-opc://artifacts/quotes/${taskId}/quote-draft.md`,
      content: draft.markdownArtifact,
      metadata: {
        workflow: 'quote',
        format: 'markdown',
        confidence: draft.confidence,
        pricingRuleCount: draft.pricingRuleCount,
        matchedRuleCount: draft.matchedRules.length,
        subtotal: draft.subtotal,
        currency: draft.currency,
        draftOnly: true,
        policy: '报价文档草案不会自动开票、收款、发送邮件或形成合同承诺。'
      }
    });
    await this.repos.audit({
      actorType: 'system',
      action: 'quote_artifact_created',
      entityType: 'artifact',
      entityId: artifact.id,
      metadata: {
        taskId,
        type: artifact.type,
        uri: artifact.uri
      }
    });
    return artifact;
  }

  private async createContentWorkflow(text: string, context: BrainContext) {
    const workStrategy = planContentWorkStrategy(text);
    const taskContract = createTaskContract(text, workStrategy);
    const visualDelivery = workStrategy.delivery.primarySurface === 'telegram_mini_app';
    const workflowTitle = workStrategy.delivery.kind === 'presentation_deck'
      ? `V3 幻灯片交付任务：${text.slice(0, 60)}`
      : `${visualDelivery ? 'V3 可视化交付任务' : 'V3 内容任务'}：${text.slice(0, 60)}`;
    const task = await this.createV3WorkflowTask({
      workflow: 'content',
      title: workflowTitle,
      description: text,
      ownerAgent: workStrategy.leadAgent,
      riskLevel: 'low',
      context,
      metadata: {
        originalText: text,
        taskContract,
        publicBrief: taskContract.publicBrief,
        workStrategy,
        deliverableKind: workStrategy.delivery.kind,
        artifactType: workStrategy.delivery.artifactType,
        deliverySurface: workStrategy.delivery.primarySurface,
        deliveryStrategy: workStrategy.delivery,
        policy: '内容草稿、标题、脚本和发布计划可自动生成；公开发布、广告投放和非邮件外部动作需要确认。'
      },
      steps: workStrategy.steps.map((step) => ({
        title: step.title,
        ownerAgent: step.ownerAgent,
        description: `${step.description}\n预期产出：${step.expectedOutput}`
      }))
    });
    const firstSubtask = (await this.repos.listSubtasks(task.id))[0] ?? null;
    const enqueueResult = await this.enqueueTask(firstSubtask?.id ?? task.id, {
      taskId: firstSubtask?.id ?? task.id,
      source: 'intake'
    });
    if (enqueueResult.queued && firstSubtask) {
      await this.repos.updateTaskStatus(task.id, 'queued', `Queued first content step ${firstSubtask.id}`);
    }
    const aiResult = await this.runAIAgent('content', text, context, task.id, {
      workflow: 'content',
      specialistWorkflow: true,
      workStrategy: {
        executionMode: workStrategy.executionMode,
        leadAgent: workStrategy.leadAgent,
        deliverableKind: workStrategy.delivery.kind,
        deliverySurface: workStrategy.delivery.primarySurface
      }
    }, {
      contentBrief: {
        publicBrief: taskContract.publicBrief,
        internalBrief: taskContract.internalBrief,
        policy: workStrategy.delivery.telegramMode === 'summary_with_preview'
          ? 'choose_display_surface_generate_artifact_do_not_dump_full_content_to_telegram'
          : 'draft_only_no_public_publish_without_approval'
      }
    });

    return [
      `Content Agent 已创建任务：${task.id}`,
      `工作策略：${workStrategy.executionMode} / lead:${workStrategy.leadAgent}`,
      `怎么做：${workStrategy.rationale}`,
      `交付方式：${workStrategy.delivery.title} / ${workStrategy.delivery.primarySurface}`,
      `展示判断：${workStrategy.delivery.rationale}`,
      firstSubtask ? `当前步骤：${firstSubtask.sequence ?? 1}. ${firstSubtask.title}` : '',
      enqueueResult.queued ? '状态：queued' : '状态：planned',
      '',
      aiResult ? this.renderAIAgentResult(aiResult) : '',
      aiResult ? '' : '',
      '当前阶段只生成内容草稿、标题、脚本和发布计划；公开发布、广告投放或非邮件外部动作需要确认。',
      `发送 \`/task ${task.id}\` 查看内容子任务。`
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  /**
   * Answers "哪个赛道现在挣钱快" by scanning the live open web for where money is
   * actually moving, instead of only reasoning over existing CRM leads.
   */
  private async createMarketScanWorkflow(text: string, context: BrainContext) {
    const assets = await this.summarizeOperatingAssets();
    const task = await this.createV3WorkflowTask({
      workflow: 'market_scan',
      title: `市场扫描：${text.slice(0, 40)}`,
      description: text,
      ownerAgent: 'prospecting',
      riskLevel: 'low',
      context,
      metadata: {
        goal: text,
        assets,
        originalText: text
      },
      steps: []
    });

    const enqueueResult = await this.enqueueTask(task.id, { taskId: task.id, source: 'intake' });

    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'market_scan_started',
      entityType: 'task',
      entityId: task.id,
      metadata: { goal: text, queued: enqueueResult.queued, sourceMessageId: context.originMessageId }
    });

    return [
      `开始扫市场：${task.id}`,
      `我手上的牌：${assets}`,
      enqueueResult.queued ? '状态：正在后台跑' : '状态：已排期',
      '',
      '我会跑多轮公开检索，专门找"现在有人正在花钱买什么"的真实证据——需求方在喊的、供给方在报价的、平台上真实成交的，',
      '然后按「多快能收到钱 × 是否用得上我现有的牌 × 证据够不够硬」排出 5 个方向，每个都给到今天就能做完的第一步。',
      `完成后发送 \`/task ${task.id}\` 看结果。`
    ].filter(Boolean).join('\n');
  }

  /** One-line inventory of what the operator can actually deploy today. */
  private async summarizeOperatingAssets(): Promise<string> {
    const parts: string[] = [];
    try {
      const { total } = await this.repos.searchLeads({ limit: 1, offset: 0 });
      if (total > 0) parts.push(`CRM 里 ${total} 条已挖到的企业线索`);
    } catch {
      // asset summary is best-effort
    }
    try {
      const profile = await this.repos.getASelfProfile();
      if (profile?.mission) parts.push(`数字自我人格已蒸馏（${profile.display_name}）`);
    } catch {
      // ignore
    }
    parts.push('一套能自动跑公开检索、读正文、抽取信息、批量写话术的 Agent 系统');
    parts.push('会写代码、能快速搭网站和自动化流程');
    parts.push('几乎没有启动资金，没有团队，不能囤货');
    return parts.join('；');
  }

  /**
   * Turns "去找 100 家 ... 问他们需不需要 X" into a real background campaign that
   * searches the open web, scores companies and writes them into CRM.
   */
  private async createLeadCampaignWorkflow(text: string, context: BrainContext) {
    const brief = await this.extractCampaignBrief(text, context);
    const task = await this.createV3WorkflowTask({
      workflow: 'lead_campaign',
      title: `客户挖掘：${brief.offer.slice(0, 40)}（${brief.target} 家）`,
      description: text,
      ownerAgent: 'prospecting',
      riskLevel: 'medium',
      context,
      metadata: {
        offer: brief.offer,
        icp: brief.icp,
        region: brief.region,
        target: brief.target,
        originalText: text
      },
      steps: []
    });

    const enqueueResult = await this.enqueueTask(task.id, { taskId: task.id, source: 'intake' });

    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'lead_campaign_started',
      entityType: 'task',
      entityId: task.id,
      metadata: { ...brief, queued: enqueueResult.queued, sourceMessageId: context.originMessageId }
    });

    return [
      `已开始挖客户：${task.id}`,
      `在卖什么：${brief.offer}`,
      `目标客户：${brief.icp}`,
      brief.region ? `地区：${brief.region}` : '',
      `目标数量：${brief.target} 家`,
      enqueueResult.queued ? '状态：正在后台跑' : '状态：已排期',
      '',
      '我会跑多轮公开检索、读取来源正文、抽取公司名、逐条打分，再给每家写一条触达话术，最后全部写进 CRM。',
      `期间会推进度给你。完成后发送 \`/task ${task.id}\` 看结果，或到 CRM 页面直接用话术。`
    ].filter(Boolean).join('\n');
  }

  /**
   * Decomposes a goal-shaped request into real executable steps using the AI
   * agent instead of punctuation splitting. Returns null when the request is
   * not a goal (short chatter, single action) so the regex planner still runs.
   */
  private async planGoalWithAI(text: string, context: BrainContext): Promise<TaskPlan | null> {
    if (!this.agentRunner) return null;
    if (text.trim().length < 24) return null;

    const knownAgents = [
      'chief_of_staff', 'prospecting', 'crm', 'solution', 'quote',
      'dev', 'email', 'finance', 'calendar', 'browser', 'content'
    ];

    try {
      const result = await this.agentRunner.run({
        agentId: 'chief_of_staff',
        systemPrompt: '你是经营目标拆解器。只输出 JSON，不要输出 Markdown 代码块。',
        userText: [
          '把下面这段请求拆成可执行的经营步骤。',
          '',
          `原话：${text}`,
          '',
          '规则：',
          '- 每一步必须是一个能真正做的动作，不能是原话的片段或标点切片',
          '- title 用祈使句写清楚要做什么，10-30 字',
          '- description 写清楚这一步的产出和判断标准',
          '- owner 从这些里选：' + knownAgents.join(' / '),
          '- 最多 6 步，按执行顺序排',
          '- 如果这段话只是一个单一动作或闲聊，不需要拆解，返回 {"isGoal":false,"steps":[]}',
          '',
          '只输出 JSON：{"isGoal":true,"goal":"一句话目标","steps":[{"title":"","description":"","owner":"chief_of_staff"}]}'
        ].join('\n'),
        context: {
          telegramUserId: context.telegramUserId,
          userId: context.userId,
          chatId: context.chatId,
          originMessageId: context.originMessageId
        },
        tools: [],
        maxToolRounds: 0,
        metadata: {
          source: 'telegram',
          sourceMessageId: context.originMessageId,
          workflow: 'goal_decomposition'
        }
      });

      const raw = result.content.replace(/```json|```/g, '').trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        isGoal?: boolean;
        goal?: string;
        steps?: Array<{ title?: string; description?: string; owner?: string }>;
      };

      if (parsed.isGoal === false) return null;
      const steps = (parsed.steps ?? [])
        .filter((step) => typeof step.title === 'string' && step.title.trim().length >= 4)
        .slice(0, 6)
        .map((step) => ({
          title: (step.title as string).trim().slice(0, 80),
          description: (step.description ?? step.title ?? '').trim().slice(0, 600),
          ownerAgent: knownAgents.includes(step.owner ?? '') ? (step.owner as string) : 'chief_of_staff'
        }));
      if (steps.length < 2) return null;

      return {
        goal: (parsed.goal ?? text).slice(0, 200),
        reasons: ['ai decomposed operating goal'],
        steps
      };
    } catch {
      return null;
    }
  }

  /** Pulls offer / ICP / region / target count out of one free-form sentence. */
  private async extractCampaignBrief(text: string, context: BrainContext) {
    const fallbackTarget = Number(text.match(/(\d{1,3})\s*(?:家|个|条)/)?.[1] ?? 0);
    const fallback = {
      offer: text,
      icp: text,
      region: '',
      target: fallbackTarget > 0 ? Math.min(200, fallbackTarget) : 20
    };
    if (!this.agentRunner) return fallback;

    try {
      const result = await this.agentRunner.run({
        agentId: 'prospecting',
        systemPrompt: '你是线索挖掘任务解析器。只输出 JSON，不要输出 Markdown。',
        userText: [
          '把下面这句话解析成一次客户挖掘任务的参数。',
          '',
          `原话：${text}`,
          '',
          '字段说明：',
          '- offer：我要卖给对方的东西/服务，用一句话写清楚',
          '- icp：应该去找什么样的公司做客户。原话没说清就根据 offer 推断最可能的买家类型，要具体到行业和业务特征',
          '- region：地区限定，没提就留空字符串',
          '- target：要找多少家，原话里的数字优先；没写数字就填 20',
          '',
          '只输出 JSON：{"offer":"","icp":"","region":"","target":20}'
        ].join('\n'),
        context: {
          telegramUserId: context.telegramUserId,
          userId: context.userId,
          chatId: context.chatId,
          originMessageId: context.originMessageId
        },
        tools: [],
        maxToolRounds: 0,
        metadata: {
          source: 'telegram',
          sourceMessageId: context.originMessageId,
          workflow: 'lead_campaign_brief'
        }
      });
      const parsed = parseJsonObjectFromText(result.content);
      if (!parsed) return fallback;
      const target = Number(parsed.target);
      return {
        offer: typeof parsed.offer === 'string' && parsed.offer.trim() ? parsed.offer.trim() : fallback.offer,
        icp: typeof parsed.icp === 'string' && parsed.icp.trim() ? parsed.icp.trim() : fallback.icp,
        region: typeof parsed.region === 'string' ? parsed.region.trim() : '',
        target: Number.isFinite(target) && target > 0 ? Math.min(200, Math.round(target)) : fallback.target
      };
    } catch {
      return fallback;
    }
  }

  private async createProspectingWorkflow(text: string, context: BrainContext) {
    const draft = buildProspectingDraft(text);
    const task = await this.createV3WorkflowTask({
      workflow: 'prospecting',
      title: `V3 客户挖掘任务：${draft.icp.segment}`,
      description: text,
      ownerAgent: 'prospecting',
      riskLevel: 'medium',
      context,
      metadata: {
        prospectingDraft: draft
      },
      steps: draft.nextAgentTasks
    });
    const run = await this.repos.createProspectingRun({
      taskId: task.id,
      originalText: draft.originalText,
      selectedSkillIds: draft.selectedSkillIds,
      icp: { ...draft.icp },
      sourceStrategy: draft.sourceStrategy,
      scoringModel: draft.scoringModel.map((item) => ({ ...item })),
      outreachDrafts: draft.outreachDrafts,
      sequence: draft.sequence.map((item) => ({ ...item })),
      complianceNotes: draft.complianceNotes,
      metadata: {
        sourceMessageId: context.originMessageId,
        workflowTaskId: task.id
      }
    });
    const publicSourceCandidates = await this.findPublicProspectingCandidates(draft, 4);
    const candidates = mergeProspectingCandidates(
      publicSourceCandidates,
      buildProspectingLeadCandidates(draft, 4),
      6
    );
    const leadBundle = await this.repos.createProspectingLeadBundle({
      prospectingRunId: run.id,
      candidates
    });
    await this.repos.audit({
      actorType: 'system',
      action: 'prospecting_candidate_leads_created',
      entityType: 'prospecting_run',
      entityId: run.id,
      metadata: {
        taskId: task.id,
        leadIds: leadBundle.leads.map((lead) => lead.id),
        leadScoreCount: leadBundle.leadScores.length,
        enrichmentResultCount: leadBundle.enrichmentResults.length,
        publicSourceCandidateCount: publicSourceCandidates.length,
        source: publicSourceCandidates.length ? 'public_source_connector_v1' : 'prospecting_candidate_seed_v1'
      }
    });
    const researchResult = await this.runAIAgent('research', text, context, task.id, {
      workflow: 'prospecting',
      handoffStage: 'research',
      selectedSkillIds: draft.selectedSkillIds
    }, {
      prospectingDraft: draft,
      sourceStrategy: draft.sourceStrategy,
      scoringModel: draft.scoringModel
    });
    const aiResult = await this.runAIAgent('prospecting', text, context, task.id, {
      workflow: 'prospecting',
      selectedSkillIds: draft.selectedSkillIds,
      upstreamRunId: researchResult?.runId
    }, {
      researchHandoff: researchResult ? toHandoffContext(researchResult) : null,
      prospectingDraft: draft
    });
    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'intake'
    });

    return [
      renderProspectingDraft(draft),
      '',
      `任务：${task.id}`,
      `Prospecting Run：${run.id}`,
      enqueueResult.queued ? `状态：queued` : '状态：planned',
      '',
      publicSourceCandidates.length
        ? `公开来源 connector：已导入 ${publicSourceCandidates.length} 条候选线索。`
        : '公开来源 connector：未配置或未命中，已使用候选线索种子兜底。',
      '',
      renderProspectingLeadCandidates(candidates),
      researchResult ? '' : '',
      researchResult ? this.renderAIAgentHandoff([researchResult], '已执行 Research 前置 run') : '',
      aiResult ? '' : '',
      aiResult ? this.renderAIAgentResult(aiResult) : '',
      '',
      '下一步不会自动购买数据、投放广告或提交外部表单；邮件发送可通过 `/send_campaign <campaign_id>` 自动执行。',
      `发送 \`/task ${task.id}\` 查看客户挖掘子任务。`
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  private async findPublicProspectingCandidates(draft: ProspectingDraft, limit: number) {
    try {
      return await this.prospectingConnector.findCandidates(draft, { limit });
    } catch (error) {
      await this.repos.audit({
        actorType: 'system',
        action: 'prospecting_public_source_connector_failed',
        entityType: 'prospecting',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error',
          source: 'public_source_connector_v1'
        }
      });
      return [];
    }
  }

  private async createSpecialistWorkflow(ownerAgent: 'quote' | 'dev', text: string, context: BrainContext) {
    const isQuote = ownerAgent === 'quote';
    const task = await this.createV3WorkflowTask({
      workflow: ownerAgent,
      title: `${isQuote ? 'V3 报价任务' : 'V3 开发任务'}：${text.slice(0, 60)}`,
      description: text,
      ownerAgent,
      riskLevel: isQuote ? 'medium' : 'low',
      context,
      metadata: {
        originalText: text,
        policy: isQuote
          ? '标准报价草案自动生成；正式开票、付款、超折扣和合同金额承诺需要确认。'
          : '允许本地代码任务规划；生产部署、密钥变更和破坏性命令需要确认。'
      },
      steps: isQuote
        ? [
            { title: '检索报价规则和服务包', ownerAgent: 'quote', description: '查找报价知识库、服务包、折扣规则和合同条款。' },
            { title: '生成报价草案和风险提示', ownerAgent: 'quote', description: '生成价格依据、适用规则、折扣边界和异常升级点。' },
            { title: '准备报价邮件草稿', ownerAgent: 'email', description: '只生成草稿，不默认外发。' }
          ]
        : [
            { title: '整理需求和验收标准', ownerAgent: 'dev', description: '把开发命令转成 spec 和 acceptance criteria。' },
            { title: '扫描仓库上下文和修改路径', ownerAgent: 'dev', description: '准备 repo context、影响范围和实现计划。' },
            { title: '执行实现、测试和代码审查', ownerAgent: 'dev', description: 'Claude Code 作为执行器之一，输出 diff、测试和 review。' }
          ]
    });
    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'intake'
    });
    const aiResult = await this.runAIAgent(ownerAgent, text, context, task.id, {
      workflow: ownerAgent,
      specialistWorkflow: true
    });

    return [
      `${isQuote ? 'Quote Agent' : 'Dev Agent Team'} 已创建任务：${task.id}`,
      enqueueResult.queued ? '状态：queued' : '状态：planned',
      '',
      aiResult ? this.renderAIAgentResult(aiResult) : '',
      aiResult ? '' : '',
      isQuote
        ? '当前阶段会生成报价草案和风险提示，不会自动开票或形成财务承诺。'
        : '当前阶段会建立开发任务链；生产部署、密钥变更和破坏性命令需要确认。',
      `发送 \`/task ${task.id}\` 查看子任务。`
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }

  private async createV3WorkflowTask(params: {
    workflow: string;
    title: string;
    description: string;
    ownerAgent: string;
    riskLevel: RiskLevel;
    context: BrainContext;
    metadata: Record<string, unknown>;
    dependencyMode?: HandoffExecutionMode;
    steps: Array<{
      title: string;
      ownerAgent: string;
      description: string;
    }>;
  }) {
    const task = await this.repos.createTask({
      title: params.title,
      description: params.description,
      originMessageId: params.context.originMessageId,
      ownerAgent: params.ownerAgent,
      riskLevel: params.riskLevel,
      status: 'planned',
      planningMetadata: {
        v3: true,
        workflow: params.workflow,
        source: 'telegram_command',
        dependencyMode: params.dependencyMode ?? 'sequence',
        ...params.metadata
      }
    });

    let previousTask: TaskRecord | null = null;
    const subtaskIds: string[] = [];
    for (const [index, step] of params.steps.entries()) {
      const subtask = await this.repos.createTask({
        title: step.title,
        description: step.description,
        originMessageId: params.context.originMessageId,
        parentTaskId: task.id,
        ownerAgent: step.ownerAgent,
        riskLevel: params.riskLevel,
        status: 'planned',
        sequence: index + 1,
        planningMetadata: {
          v3: true,
          workflow: params.workflow,
          parentTaskId: task.id,
          source: 'v3_workflow'
        }
      });
      subtaskIds.push(subtask.id);

      if (previousTask) {
        if ((params.dependencyMode ?? 'sequence') === 'sequence') {
          await this.repos.createTaskDependency({
            taskId: subtask.id,
            dependsOnTaskId: previousTask.id,
            dependencyType: 'sequence',
            metadata: {
              v3: true,
              workflow: params.workflow,
              parentTaskId: task.id
            }
          });
        }
      }
      previousTask = subtask;
    }

    await this.repos.audit({
      actorType: 'user',
      actorId: params.context.userId,
      action: 'v3_workflow_created',
      entityType: 'task',
      entityId: task.id,
      metadata: {
        workflow: params.workflow,
        ownerAgent: params.ownerAgent,
        dependencyMode: params.dependencyMode ?? 'sequence',
        subtaskIds,
        sourceMessageId: params.context.originMessageId
      }
    });

    return task;
  }

  private async listProspectingTasks(view: 'leads' | 'campaigns') {
    if (view === 'leads') {
      const leads = await this.repos.listProspectingLeads(20);
      if (leads.length) {
        return [
          '线索池 / Prospecting Leads：',
          '',
          ...leads.map((lead, index) => {
            const priority = typeof lead.score.priority === 'string' ? lead.score.priority : 'B';
            const total = typeof lead.score.total_score === 'number' ? lead.score.total_score : '待评分';
            const query = typeof lead.metadata.query === 'string' ? `\n   查询：${lead.metadata.query}` : '';
            const evidence = typeof lead.metadata.evidenceStatus === 'string' ? ` / ${lead.metadata.evidenceStatus}` : '';
            return `${index + 1}. ${lead.id} [${lead.status}] ${lead.name}\n   priority:${priority} / score:${total} / source:${lead.source}${evidence}${query}`;
          }),
          '',
          '线索已写入 leads / lead_scores / enrichment_results；配置公开来源 connector 后会同步 organization/contact，未命中时仍显示候选种子。'
        ].join('\n');
      }
    }

    if (view === 'campaigns') {
      const campaigns = await this.repos.listCampaigns(10);
      if (campaigns.length) {
        const campaignEvents = await this.repos.listCampaignEvents({ limit: 100 });
        return [
          '销售开发 Campaigns：',
          '',
          ...campaigns.map((campaign, index) => renderCampaignSummary(campaign, campaignEvents, index + 1)),
          '',
          'campaign_events 会展示 planned、email_sent、email_replied、email_opened、email_unsubscribed 等事件；邮件发送使用 Nodemailer，不需要审批。'
        ].join('\n');
      }
    }

    const tasks = await this.repos.listTasks(50);
    const prospectingTasks = tasks.filter(
      (task) => task.owner_agent === 'prospecting' || task.planning_metadata.workflow === 'prospecting'
    );
    if (!prospectingTasks.length) {
      return view === 'leads'
        ? '线索池暂无 prospecting run。发送 `/prospect <领域>` 创建客户挖掘任务。'
        : '暂无销售开发 campaign。发送 `/prospect <领域>` 创建客户挖掘任务。';
    }

    return [
      view === 'leads' ? '线索池 / Prospecting Runs：' : '销售开发 Campaigns：',
      '',
      ...prospectingTasks.slice(0, 10).map((task, index) => {
        const draft = task.planning_metadata.prospectingDraft as ProspectingDraft | undefined;
        const icp = draft ? `${draft.icp.region} / ${draft.icp.segment} / ${draft.icp.companySize}` : task.title;
        return `${index + 1}. ${task.id} [${task.status}] ${icp}\n   ${task.title}`;
      }),
      '',
      '当前 MVP 保存 ICP、来源策略、评分模型和触达草稿；真实线索抓取会在浏览器/搜索连接器阶段接入。'
    ].join('\n');
  }

  private async sendCampaign(arg: string, context: BrainContext) {
    const campaignId = arg.trim().split(/\s+/)[0];
    if (!campaignId) return '请提供 Campaign ID，例如：`/send_campaign cmp_xxx`。';

    const campaign = await this.repos.getCampaign(campaignId);
    if (!campaign) {
      return `找不到 Campaign：${campaignId}。发送 \`/campaigns\` 查看当前 campaign。`;
    }

    const task = await this.repos.createTask({
      title: `发送 Campaign 邮件：${campaign.name}`,
      description: `Use Nodemailer to send campaign ${campaign.id}`,
      originMessageId: context.originMessageId,
      ownerAgent: 'email',
      riskLevel: 'medium',
      status: 'planned',
      planningMetadata: {
        v3: true,
        workflow: 'campaign_send',
        campaignId: campaign.id,
        channel: 'email',
        sender: 'nodemailer',
        noApprovalRequired: true,
        source: 'telegram_command'
      }
    });
    const enqueueResult = await this.enqueueTask(task.id, {
      taskId: task.id,
      source: 'intake'
    });
    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'campaign_email_send_requested',
      entityType: 'campaign',
      entityId: campaign.id,
      metadata: {
        taskId: task.id,
        queued: enqueueResult.queued,
        jobId: enqueueResult.jobId,
        noApprovalRequired: true
      }
    });

    return [
      `Campaign 邮件发送任务已创建：${task.id}`,
      `Campaign：${campaign.id} / ${campaign.name}`,
      enqueueResult.queued ? `状态：queued` : '状态：planned',
      '审批：不需要',
      '',
      'worker 会用 Nodemailer 发送；若 SMTP 未配置或某条 lead 没有邮箱，会写入 email_send_skipped 事件。',
      `发送 \`/campaigns\` 查看事件汇总，或 \`/task ${task.id}\` 查看任务状态。`
    ].join('\n');
  }

  private async recordCampaignEvent(arg: string, context: BrainContext) {
    const match = arg.trim().match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/);
    if (!match) {
      return '格式：`/campaign_event <campaign_id> <event_type> [lead_id] [备注]`，例如：`/campaign_event cmp_xxx replied lead_xxx 客户感兴趣`。';
    }

    const campaignId = match[1];
    const eventType = normalizeCampaignEventType(match[2]);
    const rest = match[3]?.trim() ?? '';
    const [leadId, note] = parseCampaignEventRest(rest);
    const campaign = await this.repos.getCampaign(campaignId);
    if (!campaign) {
      return `找不到 Campaign：${campaignId}。发送 \`/campaigns\` 查看当前 campaign。`;
    }

    const event = await this.repos.createCampaignEvent({
      campaignId,
      leadId,
      eventType,
      payload: {
        channel: 'email',
        source: 'telegram_command',
        rawEventType: match[2],
        note,
        recordedByUserId: context.userId,
        sourceMessageId: context.originMessageId
      }
    });
    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'campaign_event_recorded',
      entityType: 'campaign_event',
      entityId: event.id,
      metadata: {
        campaignId,
        leadId,
        eventType
      }
    });

    return [
      `Campaign Event 已记录：${event.id}`,
      `Campaign：${campaignId}`,
      leadId ? `Lead：${leadId}` : '',
      `类型：${eventType}`,
      note ? `备注：${note}` : ''
    ].filter(Boolean).join('\n');
  }

  private async listAgentRuns() {
    const agentRuns = await this.repos.listAgentRuns(20);
    if (agentRuns.length) {
      return [
        '最近 AI Agent Runs：',
        '',
        ...agentRuns.map((run, index) => {
          const task = run.task_id ? ` task:${run.task_id}` : '';
          const tools = Array.isArray(run.output.toolCalls) ? ` / tools:${run.output.toolCalls.length}` : '';
          return `${index + 1}. ${run.id} [${run.status}] agent:${run.agent_id}${task}${tools}\n   model:${run.provider}/${run.model}`;
        })
      ].join('\n');
    }

    const tasks = await this.repos.listTasks(20);
    if (!tasks.length) return '暂无 Agent run。';
    return [
      '最近任务链 Runs（尚无 AI agent_runs）：',
      '',
      ...tasks.map((task, index) => {
        const workflow = typeof task.planning_metadata.workflow === 'string' ? ` / ${task.planning_metadata.workflow}` : '';
        return `${index + 1}. ${task.id} [${task.status}] owner:${task.owner_agent}${workflow}\n   ${task.title}`;
      })
    ].join('\n');
  }

  private async showAgentRunTrace(agentRunId: string) {
    const run = await this.repos.getAgentRun(agentRunId.trim());
    if (!run) {
      return `找不到 Agent Run：${agentRunId}。发送 \`/runs\` 查看最近 run。`;
    }

    const toolCalls = await this.repos.listToolCallsForAgentRun(run.id);
    const userText = typeof run.input.userText === 'string' ? run.input.userText : '';
    const context = isRecord(run.input.context) ? run.input.context : {};
    const contextKeys = Object.keys(context);
    const content = typeof run.output.content === 'string'
      ? run.output.content
      : typeof run.output === 'object'
        ? compactJson(run.output, 1200)
        : '';
    const metadataLines = traceMetadataLines(run.metadata);
    const linkedRuns = await this.listLinkedAgentRuns(run);
    const task = run.task_id ? `任务：${run.task_id}` : '任务：无';
    const completed = run.completed_at ? ` -> ${formatDateTime(run.completed_at)}` : '';

    return [
      `AI Agent Trace：${run.id}`,
      `Agent：${run.agent_id}`,
      `状态：${run.status}`,
      `模型：${run.provider}/${run.model}`,
      task,
      `时间：${formatDateTime(run.started_at)}${completed}`,
      metadataLines.length ? `Metadata：${metadataLines.join(' / ')}` : 'Metadata：无',
      '',
      '输入摘要：',
      userText ? truncateChars(userText, 500) : '无 userText',
      contextKeys.length ? `Context keys：${contextKeys.slice(0, 20).join(', ')}` : 'Context keys：无',
      '',
      '输出摘要：',
      content ? truncateChars(content, 1200) : (run.error ? `错误：${run.error}` : '无输出内容'),
      '',
      '工具调用：',
      toolCalls.length
        ? toolCalls.map((tool, index) => renderTraceToolCall(tool, index + 1)).join('\n')
        : '无',
      '',
      '关联 Agent Runs：',
      linkedRuns.length
        ? linkedRuns.map((linked, index) => renderLinkedAgentRun(linked, index + 1)).join('\n')
        : '无'
    ].join('\n');
  }

  private async listLinkedAgentRuns(run: AgentRunRecord) {
    const linkedRunIds = linkedRunIdsFromMetadata(run.metadata)
      .filter((runId) => runId !== run.id);
    const uniqueIds = [...new Set(linkedRunIds)];
    const linkedRuns = await Promise.all(uniqueIds.map((runId) => this.repos.getAgentRun(runId)));
    return linkedRuns.filter((linked): linked is AgentRunRecord => Boolean(linked));
  }

  private async todayBriefing(userId: string) {
    const [
      approvals,
      priorityTasks,
      blockedTasks,
      runningTasks,
      crm,
      finance,
      calendar,
      mail,
      browser,
      contextPack
    ] = await Promise.all([
      this.repos.listPendingApprovals(10),
      this.repos.listTasksByStatuses(['planned', 'queued', 'review'], 8),
      this.repos.listTasksByStatuses(['blocked', 'waiting_external', 'failed'], 5),
      this.repos.listTasksByStatuses(['running'], 5),
      this.repos.getCrmDashboard(),
      this.repos.getFinanceDashboard(),
      this.repos.getCalendarDashboard(),
      this.repos.getMailDashboard(),
      this.repos.getBrowserDashboard(),
      buildContextPack(this.repos, {
        requestId: `today_${userId}`,
        querySummary: 'today briefing company operating status'
      })
    ]);

    const lines = [
      '今日简报 v3：',
      ''
    ];

    const contextLines = summarizeContextPackForBriefing(contextPack);
    if (contextLines.length) {
      lines.push('经营上下文：');
      lines.push(...contextLines.map((item, index) => `${index + 1}. ${item}`));
      lines.push('');
    }

    if (approvals.length) {
      lines.push('待审批：');
      lines.push(
        ...approvals.map(
          (approval, index) =>
            `${index + 1}. ${approval.task_title ?? approval.action_type}\n   ${approval.id} / ${approval.action_type} / risk:${approval.risk_level}`
        )
      );
      lines.push('');
    }

    if (blockedTasks.length) {
      lines.push('阻塞事项：');
      lines.push(
        ...blockedTasks.map((task, index) => `${index + 1}. ${task.title}\n   ${task.id} / ${task.status} / risk:${task.risk_level}`)
      );
      lines.push('');
    }

    if (runningTasks.length) {
      lines.push('正在执行：');
      lines.push(
        ...runningTasks.map((task, index) => `${index + 1}. ${task.title}\n   ${task.id} / running / risk:${task.risk_level}`)
      );
      lines.push('');
    }

    if (priorityTasks.length) {
      lines.push('今日优先任务：');
      lines.push(
        ...priorityTasks.map((task, index) => `${index + 1}. ${task.title}\n   ${task.id} / ${task.status} / risk:${task.risk_level}`)
      );
      lines.push('');
    }

    const crmFocus = [
      ...crm.overdueFollowUps.slice(0, 3).map(renderBriefFollowUp),
      ...crm.riskContacts.slice(0, 2).map(renderBriefContact),
      ...crm.hotLeads.slice(0, 2).map(renderBriefContact)
    ].slice(0, 5);
    if (crmFocus.length) {
      lines.push('客户跟进：');
      lines.push(...crmFocus.map((item, index) => `${index + 1}. ${item}`));
      lines.push('');
    }

    const financeFocus = [
      `本月净现金流：${formatMoney(finance.netCashflow, finance.currency)}`,
      ...finance.riskAlerts.slice(0, 3),
      ...finance.openInvoices.slice(0, 2).map((invoice) => `未收发票：${invoice.customer_name} ${formatMoney(Number(invoice.amount), invoice.currency)} / ${invoice.status}`),
      ...finance.upcomingSubscriptions.slice(0, 2).map((subscription) => `即将扣费：${subscription.vendor_name ?? subscription.name} ${formatMoney(Number(subscription.amount), subscription.currency)}`)
    ];
    if (finance.monthlyIncome || finance.monthlyExpenses || finance.riskAlerts.length || finance.openInvoices.length || finance.upcomingSubscriptions.length) {
      lines.push('财务提醒：');
      lines.push(...financeFocus.slice(0, 6).map((item, index) => `${index + 1}. ${item}`));
      lines.push('');
    }

    const calendarFocus = [
      ...calendar.conflicts.slice(0, 2).map((conflict) => `冲突：${conflict}`),
      ...calendar.todayEvents.slice(0, 3).map((event) => `今天 ${renderCalendarEvent(event)}`),
      ...calendar.tomorrowEvents.slice(0, 3).map((event) => `明天 ${renderCalendarEvent(event)}`),
      ...calendar.meetingPrep.slice(0, 2).map((note) => `会议准备：${renderMeetingPrep(note)}`)
    ].slice(0, 6);
    if (calendarFocus.length) {
      lines.push('日程与会议：');
      lines.push(...calendarFocus.map((item, index) => `${index + 1}. ${item}`));
      lines.push('');
    }

    const mailFocus = [
      ...mail.draftsWaitingApproval.slice(0, 3).map((draft) => `邮件草稿：${renderEmailDraft(draft)}`),
      ...mail.urgent.slice(0, 3).map((thread) => `紧急邮件：${renderEmailThread(thread)}`),
      ...mail.customer.slice(0, 2).map((thread) => `客户邮件：${renderEmailThread(thread)}`)
    ].slice(0, 6);
    if (mailFocus.length) {
      lines.push('邮件处理：');
      lines.push(...mailFocus.map((item, index) => `${index + 1}. ${item}`));
      lines.push('');
    }

    const browserFocus = [
      ...browser.blockedActions.slice(0, 3).map((action) => `被拦截：${renderBrowserBlockedAction(action)}`),
      ...browser.recentRuns.slice(0, 2).map((run) => `最近运行：${renderBrowserRun(run)}`)
    ].slice(0, 5);
    if (browserFocus.length) {
      lines.push('浏览器自动化：');
      lines.push(...browserFocus.map((item, index) => `${index + 1}. ${item}`));
      lines.push('');
    }

    if (lines.length === 2) {
      lines.push('暂无待审批、阻塞、活跃任务或业务提醒。');
      lines.push('');
    }

    lines.push('建议下一步：');
    lines.push(nextActionFor({
      approvalsCount: approvals.length,
      blockedCount: blockedTasks.length,
      priorityCount: priorityTasks.length,
      crmCount: crmFocus.length,
      financeAlertCount: finance.riskAlerts.length + finance.openInvoices.length + finance.upcomingSubscriptions.length,
      mailCount: mailFocus.length,
      calendarConflictCount: calendar.conflicts.length,
      browserBlockedCount: browser.blockedActions.length
    }));

    const content = trimBlankLines(lines).join('\n');
    await this.repos.createBriefing({
      type: 'daily',
      title: 'Daily Briefing v2',
      content,
      metadata: {
        requestedByUserId: userId,
        version: 'v2',
        counts: {
          approvals: approvals.length,
          blockedTasks: blockedTasks.length,
          runningTasks: runningTasks.length,
          priorityTasks: priorityTasks.length,
          crmFocus: crmFocus.length,
          financeAlerts: finance.riskAlerts.length,
          openInvoices: finance.openInvoices.length,
          upcomingSubscriptions: finance.upcomingSubscriptions.length,
          calendarFocus: calendarFocus.length,
          mailFocus: mailFocus.length,
          browserFocus: browserFocus.length
        }
      }
    });

    return content;
  }

  private async listTasks() {
    const tasks = await this.repos.listTasks(20);
    if (!tasks.length) return '暂无任务。';
    return tasks
      .map((task) => `- ${task.id} [${task.status}] ${task.title}`)
      .join('\n');
  }

  private async crmDashboard() {
    const dashboard = await this.repos.getCrmDashboard();
    if (
      !dashboard.hotLeads.length &&
      !dashboard.overdueFollowUps.length &&
      !dashboard.upcomingFollowUps.length &&
      !dashboard.openOpportunities.length &&
      !dashboard.riskContacts.length
    ) {
      return 'CRM 看板：暂无客户数据。你可以发送：把 Jane 加为新线索，她来自 Acme，对企业版感兴趣。';
    }

    return [
      'CRM 看板：',
      '',
      ...dashboardSection('热线索', dashboard.hotLeads, (contact) =>
        `${contact.name}${contact.organization_name ? ` / ${contact.organization_name}` : ''}${contact.notes ? `\n   ${contact.notes}` : ''}`
      ),
      ...dashboardSection('逾期跟进', dashboard.overdueFollowUps, (followUp) =>
        `${followUp.contact_name ?? followUp.contact_id}${followUp.organization_name ? ` / ${followUp.organization_name}` : ''}\n   ${followUp.id} / ${followUp.note}`
      ),
      ...dashboardSection('近期跟进', dashboard.upcomingFollowUps, (followUp) =>
        `${followUp.contact_name ?? followUp.contact_id}${followUp.organization_name ? ` / ${followUp.organization_name}` : ''}\n   ${followUp.id} / ${followUp.note}`
      ),
      ...dashboardSection('开放机会', dashboard.openOpportunities, (opportunity) =>
        `${opportunity.title} / ${opportunity.stage}${opportunity.organization_name ? ` / ${opportunity.organization_name}` : ''}`
      ),
      ...dashboardSection('风险客户', dashboard.riskContacts, (contact) =>
        `${contact.name}${contact.organization_name ? ` / ${contact.organization_name}` : ''}`
      )
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async financeDashboard() {
    const dashboard = await this.repos.getFinanceDashboard();
    if (
      dashboard.monthlyIncome === 0 &&
      dashboard.monthlyExpenses === 0 &&
      !dashboard.openInvoices.length &&
      !dashboard.upcomingSubscriptions.length &&
      !dashboard.recentTransactions.length
    ) {
      return '财务看板：暂无财务数据。你可以发送：记录收入 12000 元 来自 Acme，企业版订阅。';
    }

    return [
      '财务看板：',
      '',
      `本月收入：${formatMoney(dashboard.monthlyIncome, dashboard.currency)}`,
      `本月支出：${formatMoney(dashboard.monthlyExpenses, dashboard.currency)}`,
      `本月净现金流：${formatMoney(dashboard.netCashflow, dashboard.currency)}`,
      '',
      ...dashboardSection('风险提醒', dashboard.riskAlerts, (alert) => alert),
      ...dashboardSection('建议动作', dashboard.suggestedActions, (action) => action),
      ...dashboardSection('未收发票', dashboard.openInvoices, renderInvoice),
      ...dashboardSection('即将扣费订阅', dashboard.upcomingSubscriptions, renderSubscription),
      ...dashboardSection('最近交易', dashboard.recentTransactions, renderTransaction)
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async calendarDashboard() {
    const dashboard = await this.repos.getCalendarDashboard();
    if (
      !dashboard.todayEvents.length &&
      !dashboard.tomorrowEvents.length &&
      !dashboard.conflicts.length &&
      !dashboard.meetingPrep.length
    ) {
      return '日历看板：暂无日程数据。你可以发送：记录会议 2026-06-12 10:00 和 Alice 讨论企业版 demo，需要准备资料。';
    }

    return [
      '日历看板：',
      '',
      ...dashboardSection('今日日程', dashboard.todayEvents, renderCalendarEvent),
      ...dashboardSection('明日日程', dashboard.tomorrowEvents, renderCalendarEvent),
      ...dashboardSection('冲突', dashboard.conflicts, (conflict) => conflict),
      ...dashboardSection('空闲时间', dashboard.availabilityWindows, renderAvailabilityWindow),
      ...dashboardSection('会议准备', dashboard.meetingPrep, renderMeetingPrep)
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async browserDashboard() {
    const dashboard = await this.repos.getBrowserDashboard();
    if (
      !dashboard.recentRuns.length &&
      !dashboard.blockedActions.length &&
      !dashboard.recentScreenshots.length &&
      !dashboard.recentExtractions.length
    ) {
      return '浏览器看板：暂无浏览器运行。你可以发送：去 Stripe 看看最近失败付款，整理原因。';
    }

    return [
      '浏览器看板：',
      '',
      ...dashboardSection('最近运行', dashboard.recentRuns, renderBrowserRun),
      ...dashboardSection('被拦截动作', dashboard.blockedActions, renderBrowserBlockedAction),
      ...dashboardSection('截图证据', dashboard.recentScreenshots, renderBrowserScreenshot),
      ...dashboardSection('提取结果', dashboard.recentExtractions, renderBrowserExtraction)
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async opsDashboard(context?: BrainContext) {
    const dashboard = await this.repos.getOpsDashboard();
    if (
      !dashboard.retriableTasks.length &&
      !dashboard.retryEvents.length &&
      !dashboard.integrationHealthChecks.length &&
      !dashboard.auditExports.length &&
      !dashboard.backupRuns.length &&
      !dashboard.evaluationCases.length &&
      !dashboard.evaluationRuns.length &&
      !dashboard.permissionProfiles.length
    ) {
      return 'Ops 看板：暂无治理数据。你可以先运行任务，或使用 `/retry <task_id>` 重试失败任务。';
    }

    const aiResult = context
      ? await this.runAIAgent('ops', '/ops', context, undefined, {
          workflow: 'ops',
          action: 'dashboard',
          retriableTaskCount: dashboard.retriableTasks.length,
          retryEventCount: dashboard.retryEvents.length,
          integrationHealthCount: dashboard.integrationHealthChecks.length,
          auditExportCount: dashboard.auditExports.length,
          backupRunCount: dashboard.backupRuns.length,
          evaluationRunCount: dashboard.evaluationRuns.length,
          permissionProfileCount: dashboard.permissionProfiles.length
        }, {
          opsDashboard: dashboard
        })
      : null;

    return [
      'Ops 看板：',
      '',
      ...dashboardSection('可重试任务', dashboard.retriableTasks, renderRetriableTask),
      ...dashboardSection('最近重试', dashboard.retryEvents, renderRetryEvent),
      ...dashboardSection('集成健康', dashboard.integrationHealthChecks, renderIntegrationHealthCheck),
      ...dashboardSection('审计导出', dashboard.auditExports, renderAuditExport),
      ...dashboardSection('备份运行', dashboard.backupRuns, renderBackupRun),
      ...dashboardSection('评估用例', dashboard.evaluationCases, renderEvaluationCase),
      ...dashboardSection('评估运行', dashboard.evaluationRuns, renderEvaluationRun),
      ...dashboardSection('权限配置', dashboard.permissionProfiles, renderPermissionProfile),
      aiResult ? '' : '',
      aiResult ? this.renderAIAgentResult(aiResult) : ''
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async settings(arg: string | undefined, context: BrainContext) {
    const command = arg?.trim();
    if (command) {
      const preference = command.match(/^(?:preference|pref|prefer|偏好|记住)\s+([\s\S]+)$/i);
      if (preference?.[1]?.trim()) {
        return this.setPreference(preference[1].trim(), context);
      }

      if (/^(?:integrations|integration|集成)$/i.test(command)) {
        return this.settingsIntegrations();
      }

      if (/^(?:approvals|approval|审批)$/i.test(command)) {
        return this.settingsApprovals();
      }

      if (/^(?:guardrails|guardrail|policy|policies|边界|权限边界)$/i.test(command)) {
        return this.settingsGuardrails();
      }

      if (/^(?:memory|memories|偏好记忆|记忆)$/i.test(command)) {
        return this.settingsPreferences();
      }

      return [
        `暂不支持设置命令：${command}`,
        '',
        '可用格式：',
        '`/settings`',
        '`/settings preference 客户跟进邮件最多 120 字`',
        '`/settings integrations`',
        '`/settings approvals`',
        '`/settings guardrails`',
        '`/settings memory`'
      ].join('\n');
    }

    const [preferences, ops] = await Promise.all([
      this.repos.listMemories({ type: 'preference', limit: 5 }),
      this.repos.getOpsDashboard()
    ]);
    const profile = buildSettingsProfile(ops.integrationHealthChecks);

    return [
      '设置看板：',
      '',
      '运行配置：',
      `1. 环境：${profile.env}`,
      `2. 时区：${profile.timezone}`,
      `3. 公开地址：${profile.publicBaseUrl}`,
      `4. 语言：${profile.language}`,
      '',
      '审批边界：',
      ...defaultApprovalBoundary().map((item, index) => `${index + 1}. ${item}`),
      '',
      '集成状态：',
      ...profile.integrations.map((item, index) => `${index + 1}. ${item}`),
      '',
      '偏好记忆：',
      ...(preferences.length
        ? preferences.map((memory, index) => `${index + 1}. ${memory.content}\n   ${memory.id}`)
        : ['暂无偏好。发送 `/settings preference ...` 可以写入。']),
      '',
      '常用命令：',
      '`/settings preference 客户跟进邮件最多 120 字`',
      '`/settings integrations`',
      '`/settings approvals`',
      '`/settings guardrails`'
    ].join('\n');
  }

  private async setPreference(content: string, context: BrainContext) {
    const memory = await this.repos.createMemory({
      type: 'preference',
      content,
      createdByUserId: context.userId,
      source: {
        sourceType: 'telegram_settings',
        sourceId: context.originMessageId,
        metadata: {
          telegramUserId: context.telegramUserId,
          chatId: context.chatId
        }
      },
      metadata: {
        source: 'settings_command'
      }
    });
    await this.repos.audit({
      actorType: 'user',
      actorId: context.userId,
      action: 'settings_preference_updated',
      entityType: 'memory',
      entityId: memory.id,
      metadata: {
        type: memory.type,
        sourceMessageId: context.originMessageId
      }
    });

    return [
      `已更新偏好：${memory.id}`,
      '',
      memory.content,
      '',
      '后续起草邮件、客户跟进和简报时会优先参考这类偏好记忆。'
    ].join('\n');
  }

  private async settingsIntegrations() {
    const ops = await this.repos.getOpsDashboard();
    const profile = buildSettingsProfile(ops.integrationHealthChecks);
    return [
      '集成状态：',
      '',
      ...profile.integrations.map((item, index) => `${index + 1}. ${item}`),
      '',
      '发送 `/healthcheck` 可以刷新 PostgreSQL、Redis、Telegram、AI、Email/Calendar、Finance 和 Browser 的健康状态。'
    ].join('\n');
  }

  private async settingsApprovals() {
    const approvals = await this.repos.listPendingApprovals(10);
    return [
      '审批边界：',
      '',
      ...defaultApprovalBoundary().map((item, index) => `${index + 1}. ${item}`),
      '',
      '待审批：',
      ...(approvals.length
        ? approvals.map((approval, index) => `${index + 1}. ${approval.id} / ${approval.action_type} / risk:${approval.risk_level}`)
        : ['暂无待审批动作。']),
      '',
      'Telegram 不会直接写入 secret；真实 token、OAuth refresh token 和支付密钥仍应放在 `.env`、secret manager 或服务器环境变量中。'
    ].join('\n');
  }

  private async settingsGuardrails() {
    const [approvals, ops] = await Promise.all([
      this.repos.listPendingApprovals(10),
      this.repos.getOpsDashboard()
    ]);
    const profile = buildSettingsProfile(ops.integrationHealthChecks);
    return [
      'Guardrails Console：',
      '',
      '审批边界：',
      ...defaultApprovalBoundary().map((item, index) => `${index + 1}. ${item}`),
      '',
      '外部写入工具：',
      '1. `external_write_request`：approval-gated；只生成审批，不直接发送、付款、提交表单、发布或部署。',
      '2. 审批通过后，当前默认进入任务队列或标记为已批准；真实 Email/Calendar/Browser/Finance/Deploy connector 仍需单独配置。',
      '',
      '待审批：',
      ...(approvals.length
        ? approvals.map((approval, index) => `${index + 1}. ${approval.id} / ${approval.action_type} / risk:${approval.risk_level}`)
        : ['暂无待审批动作。']),
      '',
      '集成状态：',
      ...profile.integrations.map((item, index) => `${index + 1}. ${item}`)
    ].join('\n');
  }

  private async settingsPreferences() {
    const preferences = await this.repos.listMemories({ type: 'preference', limit: 10 });
    if (!preferences.length) {
      return '暂无偏好记忆。你可以发送：`/settings preference 客户跟进邮件最多 120 字`';
    }

    return [
      '偏好记忆：',
      '',
      ...preferences.map((memory, index) => `${index + 1}. ${memory.content}\n   ${memory.id}`)
    ].join('\n');
  }

  private async mailDashboard() {
    const dashboard = await this.repos.getMailDashboard();
    if (
      !dashboard.urgent.length &&
      !dashboard.customer.length &&
      !dashboard.finance.length &&
      !dashboard.calendar.length &&
      !dashboard.draftsWaitingApproval.length
    ) {
      return '邮件看板：暂无邮件数据。你可以发送：记录邮件 Jane <jane@acme.com> 主题：企业版咨询 正文：客户想了解报价，需要回复。';
    }

    return [
      '邮件看板：',
      '',
      ...dashboardSection('紧急邮件', dashboard.urgent, renderEmailThread),
      ...dashboardSection('客户邮件', dashboard.customer, renderEmailThread),
      ...dashboardSection('财务邮件', dashboard.finance, renderEmailThread),
      ...dashboardSection('日历邮件', dashboard.calendar, renderEmailThread),
      ...dashboardSection('邮件草稿', dashboard.draftsWaitingApproval, renderEmailDraft)
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async listMemories(arg?: string) {
    const requestedType = arg?.trim();
    let memoryType: MemoryType | undefined;
    if (requestedType) {
      if (!isMemoryType(requestedType)) {
        return [
          `不支持的记忆类型：${requestedType}`,
          `可用类型：${supportedMemoryTypes().join(', ')}`
        ].join('\n');
      }
      memoryType = requestedType;
    }

    const memories = await this.repos.listMemories({
      limit: 10,
      type: memoryType
    });

    if (!memories.length) {
      return requestedType ? `暂无 ${requestedType} 类型的公司记忆。` : '暂无公司记忆。你可以发送：记住：我们的语气要简洁、直接。';
    }

    return [
      requestedType ? `公司记忆 / ${requestedType}：` : '公司记忆：',
      '',
      ...memories.map((memory, index) => `${index + 1}. [${memory.type}] ${memory.content}\n   ${memory.id}`)
    ].join('\n');
  }

  private async createReview(arg: string, userId: string) {
    const [taskId, ...noteParts] = arg.trim().split(/\s+/);
    const note = noteParts.join(' ').trim();
    if (!taskId) return '请提供任务 ID，例如：`/review tsk_xxx 已完成，流程可以复用。`';

    const task = await this.repos.getTask(taskId);
    if (!task) return `没有找到任务：${taskId}`;

    const draft = createReviewDraft(task, note);
    const review = await this.repos.createReview({
      taskId: task.id,
      outcome: draft.outcome,
      resultMet: draft.resultMet,
      lessons: draft.lessons,
      nextActions: draft.nextActions,
      playbookCandidate: draft.playbookCandidate,
      createdByUserId: userId,
      metadata: {
        source: 'telegram_command',
        note
      }
    });

    let playbookId: string | undefined;
    if (draft.playbookCandidate) {
      const playbook = await this.repos.createPlaybook({
        title: `Playbook: ${task.title}`.slice(0, 120),
        content: draft.playbookCandidate,
        sourceReviewId: review.id,
        sourceTaskId: task.id,
        metadata: {
          generatedBy: 'review_loop_v0'
        }
      });
      playbookId = playbook.id;
    }

    await this.repos.audit({
      actorType: 'user',
      actorId: userId,
      action: 'task_review_created',
      entityType: 'review',
      entityId: review.id,
      metadata: {
        taskId: task.id,
        playbookId
      }
    });

    return [
      `已生成任务复盘：${review.id}`,
      `任务：${task.id}`,
      `结果达标：${review.result_met ? '是' : '否'}`,
      '',
      '经验：',
      ...review.lessons.map((lesson, index) => `${index + 1}. ${lesson}`),
      '',
      '下一步：',
      ...review.next_actions.map((action, index) => `${index + 1}. ${action}`),
      playbookId ? '' : '',
      playbookId ? `已沉淀 playbook：${playbookId}` : ''
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private async listReviews() {
    const reviews = await this.repos.listReviews(10);
    if (!reviews.length) return '暂无任务复盘。你可以发送：`/review tsk_xxx 已完成，流程可以复用。`';

    return [
      '任务复盘：',
      '',
      ...reviews.map((review, index) => `${index + 1}. ${review.id} / task:${review.task_id} / result_met:${review.result_met}`)
    ].join('\n');
  }

  private async listPlaybooks() {
    const playbooks = await this.repos.listPlaybooks(10);
    if (!playbooks.length) return '暂无 playbook。你可以在 `/review` 里写“沉淀为流程”来生成。';

    return [
      'Playbooks：',
      '',
      ...playbooks.map((playbook, index) => `${index + 1}. ${playbook.id} ${playbook.title}`)
    ].join('\n');
  }

  private async exportAuditLogs(arg: string | undefined, userId: string) {
    const parsedLimit = parseOptionalPositiveInt(arg);
    if (parsedLimit === 'invalid') {
      return '请提供 1-1000 之间的导出数量，例如：`/audit_export 200`';
    }

    try {
      const result = await this.auditExporter.exportRecent({
        requestedByUserId: userId,
        limit: parsedLimit
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'audit_export_completed',
        entityType: 'audit_export',
        entityId: result.record.id,
        metadata: {
          rowCount: result.rowCount,
          artifactPath: result.artifactPath
        }
      });

      return [
        `已导出审计日志：${result.record.id}`,
        `格式：jsonl`,
        `数量：${result.rowCount}`,
        `路径：${result.artifactPath}`,
        '',
        '发送 `/ops` 可以查看最近审计导出记录。'
      ].join('\n');
    } catch (error) {
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'audit_export_failed',
        entityType: 'audit_export',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      return [
        '审计日志导出失败。',
        error instanceof Error ? `原因：${error.message}` : '原因：unknown error'
      ].join('\n');
    }
  }

  private async runHealthChecks(userId: string) {
    const result = await this.healthChecker.runAll();
    await this.repos.audit({
      actorType: 'user',
      actorId: userId,
      action: 'integration_health_checked',
      entityType: 'integration_health_check',
      metadata: {
        checkCount: result.checks.length,
        okCount: result.okCount,
        warningCount: result.warningCount,
        failedCount: result.failedCount,
        integrations: result.checks.map((check) => ({
          integration: check.integration,
          status: check.status
        }))
      }
    });

    return [
      '集成健康检查：',
      '',
      `OK：${result.okCount}`,
      `警告：${result.warningCount}`,
      `失败：${result.failedCount}`,
      '',
      ...result.checks.map((check, index) => `${index + 1}. ${check.integration} / ${check.status}\n   ${check.id}`),
      '',
      '发送 `/ops` 可以查看最新集成健康记录。'
    ].join('\n');
  }

  private async runEvaluations(userId: string) {
    try {
      const result = await this.evaluationRunner.runManual({
        requestedByUserId: userId
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'evaluation_run_completed',
        entityType: 'evaluation_run',
        entityId: result.record.id,
        metadata: {
          status: result.record.status,
          totalCount: result.totalCount,
          passedCount: result.passedCount,
          failedCount: result.failedCount,
          skippedCount: result.skippedCount
        }
      });

      return [
        `评估套件已运行：${result.record.id}`,
        `状态：${result.record.status}`,
        '',
        `总数：${result.totalCount}`,
        `通过：${result.passedCount}`,
        `失败：${result.failedCount}`,
        `跳过：${result.skippedCount}`,
        '',
        ...result.results.map((item, index) => `${index + 1}. ${item.name} / ${item.status}`),
        '',
        '发送 `/ops` 可以查看最近评估运行记录。'
      ].join('\n');
    } catch (error) {
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'evaluation_run_failed',
        entityType: 'evaluation_run',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      return [
        '评估套件运行失败。',
        error instanceof Error ? `原因：${error.message}` : '原因：unknown error'
      ].join('\n');
    }
  }

  private async createBackup(arg: string | undefined, userId: string) {
    const parsedLimit = parseOptionalBackupRowLimit(arg);
    if (parsedLimit === 'invalid') {
      return '请提供 1-50000 之间的每表行数，例如：`/backup 5000`';
    }

    try {
      const result = await this.backupRunner.runManual({
        requestedByUserId: userId,
        rowLimit: parsedLimit
      });
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'backup_completed',
        entityType: 'backup_run',
        entityId: result.record.id,
        metadata: {
          artifactPath: result.artifactPath,
          tableCount: result.tableCount,
          rowCount: result.rowCount
        }
      });

      return [
        `已创建本地备份：${result.record.id}`,
        `类型：manual_jsonl`,
        `表数：${result.tableCount}`,
        `行数：${result.rowCount}`,
        `路径：${result.artifactPath}`,
        '',
        '发送 `/ops` 可以查看最近备份运行记录。'
      ].join('\n');
    } catch (error) {
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'backup_failed',
        entityType: 'backup_run',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      return [
        '本地备份失败。',
        error instanceof Error ? `原因：${error.message}` : '原因：unknown error'
      ].join('\n');
    }
  }

  private async retryTask(id: string, userId: string) {
    const task = await this.repos.getTask(id);
    if (!task) return `没有找到任务：${id}`;

    const lifecycleTarget = await this.resolveExecutableForRequestedTask(task);
    if (lifecycleTarget.blockedBy) {
      return [
        `不能跳过前置步骤执行 ${task.id}。`,
        `前置步骤还没完成：${lifecycleTarget.blockedBy.id} [${lifecycleTarget.blockedBy.status}] ${lifecycleTarget.blockedBy.title}`,
        '',
        task.parent_task_id
          ? `请先继续父任务：/task ${task.parent_task_id}`
          : `请先处理当前步骤：/task ${lifecycleTarget.blockedBy.id}`
      ].join('\n');
    }

    const targetTask = lifecycleTarget.executable ?? task;
    if (!isRetryableTaskStatus(targetTask.status)) {
      return [
        `任务 ${targetTask.id} 当前状态是 ${targetTask.status}，不能直接重试。`,
        '可重试状态：failed、blocked、waiting_external、planned。'
      ].join('\n');
    }

    const retryEvent = await this.repos.createRetryEvent({
      taskId: targetTask.id,
      requestedByUserId: userId,
      reason: `Manual retry requested from Telegram while task was ${targetTask.status}.`,
      metadata: {
        requestedTaskId: task.id,
        previousStatus: targetTask.status,
        source: 'telegram_command',
        lifecycleRouted: targetTask.id !== task.id
      }
    });

    await this.repos.audit({
      actorType: 'user',
      actorId: userId,
      action: 'task_retry_requested',
      entityType: 'task',
      entityId: targetTask.id,
      metadata: {
        requestedTaskId: task.id,
        retryEventId: retryEvent.id,
        previousStatus: targetTask.status
      }
    });

    const enqueueResult = await this.enqueueTask(targetTask.id, {
      taskId: targetTask.id,
      source: 'retry'
    });

    await this.repos.updateRetryEventStatus(retryEvent.id, enqueueResult.queued ? 'queued' : 'planned', {
      jobId: enqueueResult.jobId,
      queued: enqueueResult.queued
    });

    return [
      targetTask.id === task.id ? `已请求重试任务：${targetTask.id}` : `已按顺序推进下一步：${targetTask.id}`,
      targetTask.id !== task.id ? `所属任务：${task.id}` : '',
      `重试事件：${retryEvent.id}`,
      enqueueResult.queued ? '状态：queued' : '状态：planned',
      enqueueResult.queued
        ? `已重新纳入任务队列${enqueueResult.jobId ? `：${enqueueResult.jobId}` : '。'}`
        : '队列暂时不可用；任务已保留为 planned，稍后可以再次重试。'
    ].join('\n');
  }

  private async showTask(id: string) {
    const [task, subtasks] = await Promise.all([
      this.repos.getTask(id),
      this.repos.listSubtasks(id)
    ]);
    if (!task) return `没有找到任务：${id}`;
    const lines = [
      `任务：${task.id}`,
      `标题：${task.title}`,
      `状态：${task.status}`,
      `负责人：${task.owner_agent}`,
      `风险：${task.risk_level}`,
      task.description ? `描述：${task.description}` : ''
    ].filter(Boolean);

    if (subtasks.length) {
      lines.push('', '子任务：');
      lines.push(
        ...subtasks.map(
          (subtask, index) =>
            `${index + 1}. ${subtask.id} [${subtask.status}] ${subtask.title}\n   owner:${subtask.owner_agent} / risk:${subtask.risk_level}${
              index > 0 ? ' / depends_on:previous' : ''
            }`
        )
      );
    }

    return lines.join('\n');
  }

  private async decideApproval(id: string, status: 'approved' | 'rejected', userId: string) {
    const approval = await this.repos.updateApprovalStatus(id, status, userId);
    if (!approval) return `没有找到审批：${id}`;

    await this.repos.audit({
      actorType: 'user',
      actorId: userId,
      action: `approval_${status}`,
      entityType: 'approval',
      entityId: id
    });

    if (!approval.task_id) {
      return `审批 ${id} 已${status === 'approved' ? '批准' : '拒绝'}。`;
    }

    if (status === 'approved') {
      const enqueueResult = await this.enqueueTask(approval.task_id, {
        taskId: approval.task_id,
        source: 'approval',
        approvalId: approval.id,
        actionType: approval.action_type
      });

      return [
        `审批 ${id} 已批准。`,
        enqueueResult.queued
          ? `关联任务已进入队列${enqueueResult.jobId ? `：${enqueueResult.jobId}` : '。'}`
          : '关联任务已批准，但队列暂时不可用；任务已保留为 planned，稍后可重试。'
      ].join('\n');
    }

    await this.repos.updateTaskStatus(approval.task_id, 'blocked', 'Approval rejected');
    return `审批 ${id} 已拒绝。关联任务已阻塞。`;
  }

  private createDraftIfUseful(text: string, context: DraftContext) {
    if (!/邮件|email|跟进|客户|联系/i.test(text)) return null;
    const recipient = extractRecipient(text);
    const defaultDraft = [
      '主题：跟进上次沟通',
      '',
      `你好${recipient ? ` ${recipient}` : ''}，想跟进一下我们之前讨论的事项。`,
      '如果你这边方便，我可以继续补充方案细节或安排一个简短沟通。',
      '',
      '谢谢。'
    ].join('\n');

    const textDraft = context.maxChars && charLength(defaultDraft) > context.maxChars
      ? compactFollowUpDraft(recipient, context.maxChars)
      : defaultDraft;

    return {
      text: textDraft,
      appliedMemories: context.appliedMemories,
      constraints: {
        maxChars: context.maxChars,
        toneNotes: context.toneNotes
      }
    };
  }
}

function extractRecipient(text: string) {
  const match = text.match(/给\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*(?:的|写|发|起草|准备)?/) ?? text.match(/for\s+([A-Za-z0-9_-]+)/i);
  return match?.[1];
}

function compactFollowUpDraft(recipient: string | undefined, maxChars: number) {
  const candidates = [
    `主题：跟进\n\n你好${recipient ? ` ${recipient}` : ''}，想跟进上次沟通。如方便，我可以补充方案或约个简短时间继续聊。谢谢。`,
    `你好${recipient ? ` ${recipient}` : ''}，想跟进上次沟通。如方便，我可以补充方案或约个简短时间继续聊。谢谢。`,
    `你好${recipient ? ` ${recipient}` : ''}，跟进上次沟通。如方便，我可补充方案或约时间聊。谢谢。`
  ];

  return candidates.find((candidate) => charLength(candidate) <= maxChars) ?? truncateChars(candidates.at(-1)!, maxChars);
}

function truncateChars(text: string, maxChars: number) {
  if (charLength(text) <= maxChars) return text;
  const chars = Array.from(text);
  if (maxChars <= 1) return chars.slice(0, maxChars).join('');
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}

function renderTraceToolCall(tool: ToolCallRecord, index: number) {
  const approval = tool.approval_required ? ` / approval:${tool.approval_id ?? 'required'}` : '';
  const error = tool.error ? ` / error:${truncateChars(tool.error, 120)}` : '';
  return [
    `${index}. ${tool.tool_name} [${tool.status}]${approval}${error}`,
    `   input:${compactJson(tool.input, 300)}`,
    `   output:${compactJson(tool.output, 500)}`
  ].join('\n');
}

function renderCampaignSummary(campaign: CampaignRecord, events: CampaignEventRecord[], index: number) {
  const campaignEvents = events.filter((event) => event.campaign_id === campaign.id);
  const planned = campaignEvents
    .filter((event) => event.event_type === 'planned_outreach_step')
    .sort((a, b) => sequenceFromCampaignEvent(a) - sequenceFromCampaignEvent(b));
  const emailSent = campaignEvents.filter((event) => event.event_type === 'email_sent').length;
  const replied = campaignEvents.filter((event) => event.event_type === 'email_replied').length;
  const opened = campaignEvents.filter((event) => event.event_type === 'email_opened').length;
  const unsubscribed = campaignEvents.filter((event) => event.event_type === 'email_unsubscribed').length;
  const preview = planned.slice(0, 2).map((event) => {
    const day = typeof event.payload.day === 'number' ? `D${event.payload.day}` : 'D?';
    const action = typeof event.payload.action === 'string' ? truncateChars(event.payload.action, 80) : event.event_type;
    return `   - ${day}: ${action}`;
  });
  return [
    `${index}. ${campaign.id} [${campaign.status}] ${campaign.name}`,
    `   planned_events:${planned.length} / sent:${emailSent} / replied:${replied} / opened:${opened} / unsubscribed:${unsubscribed} / total_events:${campaignEvents.length}`,
    ...preview
  ].join('\n');
}

function sequenceFromCampaignEvent(event: CampaignEventRecord) {
  return typeof event.payload.sequence === 'number' ? event.payload.sequence : Number.MAX_SAFE_INTEGER;
}

function normalizeCampaignEventType(value: string) {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    sent: 'email_sent',
    send_failed: 'email_send_failed',
    failed: 'email_send_failed',
    skipped: 'email_send_skipped',
    replied: 'email_replied',
    reply: 'email_replied',
    opened: 'email_opened',
    open: 'email_opened',
    unsubscribed: 'email_unsubscribed',
    unsubscribe: 'email_unsubscribed',
    bounced: 'email_bounced',
    bounce: 'email_bounced'
  };
  return aliases[normalized] ?? (normalized.startsWith('email_') ? normalized : `email_${normalized}`);
}

function parseCampaignEventRest(rest: string) {
  if (!rest) return [null, ''] as const;
  const [first, ...remaining] = rest.split(/\s+/);
  if (/^lead_[\w-]+$/i.test(first)) {
    return [first, remaining.join(' ').trim()] as const;
  }
  return [null, rest] as const;
}

function traceMetadataLines(metadata: Record<string, unknown>) {
  const keys = [
    'workflow',
    'handoffStage',
    'upstreamRunId',
    'handoffRootRunId',
    'action',
    'specialistWorkflow',
    'specialistExecutionMode',
    'specialistHandoffTaskId',
    'attempt',
    'maxAttempts',
    'partialResultCount',
    'specialistFailureCount'
  ];
  const lines = keys
    .filter((key) => metadata[key] !== undefined)
    .map((key) => `${key}:${String(metadata[key])}`);
  if (Array.isArray(metadata.handoffRunIds) && metadata.handoffRunIds.length) {
    lines.push(`handoffRunIds:${metadata.handoffRunIds.join(',')}`);
  }
  if (Array.isArray(metadata.specialistRunIds) && metadata.specialistRunIds.length) {
    lines.push(`specialistRunIds:${metadata.specialistRunIds.join(',')}`);
  }
  if (Array.isArray(metadata.specialistAgents) && metadata.specialistAgents.length) {
    lines.push(`specialistAgents:${metadata.specialistAgents.join(',')}`);
  }
  return lines;
}

function linkedRunIdsFromMetadata(metadata: Record<string, unknown>) {
  const ids: string[] = [];
  if (typeof metadata.upstreamRunId === 'string') ids.push(metadata.upstreamRunId);
  if (typeof metadata.handoffRootRunId === 'string') ids.push(metadata.handoffRootRunId);
  if (Array.isArray(metadata.handoffRunIds)) {
    ids.push(...metadata.handoffRunIds.filter((item): item is string => typeof item === 'string'));
  }
  if (Array.isArray(metadata.specialistRunIds)) {
    ids.push(...metadata.specialistRunIds.filter((item): item is string => typeof item === 'string'));
  }
  return ids;
}

function settledArray<T>(result: PromiseSettledResult<T[]>, label: string, errors: string[]) {
  if (result.status === 'fulfilled') return result.value;
  errors.push(`${label}:${result.reason instanceof Error ? result.reason.message : 'unknown'}`);
  return [];
}

function compactRuntimeTask(task: TaskRecord) {
  return {
    id: task.id,
    title: task.title,
    description: task.description?.slice(0, 1000) ?? null,
    ownerAgent: task.owner_agent,
    priority: task.priority,
    riskLevel: task.risk_level,
    status: task.status,
    planningMetadata: task.planning_metadata,
    result: task.result?.slice(0, 1000) ?? null,
    createdAt: task.created_at,
    updatedAt: task.updated_at
  };
}

function compactRuntimeMessage(message: RecentChatMessage) {
  return {
    id: message.id,
    direction: message.direction,
    text: message.text?.slice(0, 1000) ?? null,
    createdAt: message.created_at
  };
}

function compactRuntimeApproval(approval: PendingApprovalRecord) {
  return {
    id: approval.id,
    taskId: approval.task_id,
    taskTitle: approval.task_title,
    actionType: approval.action_type,
    status: approval.status,
    riskLevel: approval.risk_level,
    prompt: approval.prompt.slice(0, 1000),
    createdAt: approval.created_at
  };
}

function renderLinkedAgentRun(run: AgentRunRecord, index: number) {
  const task = run.task_id ? ` / task:${run.task_id}` : '';
  const workflow = typeof run.metadata.workflow === 'string' ? ` / workflow:${run.metadata.workflow}` : '';
  const stage = typeof run.metadata.handoffStage === 'string' ? ` / stage:${run.metadata.handoffStage}` : '';
  const tools = Array.isArray(run.output.toolCalls) ? ` / tools:${run.output.toolCalls.length}` : '';
  return `${index}. ${run.id} [${run.status}] agent:${run.agent_id}${task}${workflow}${stage}${tools}`;
}

function compactJson(value: unknown, maxChars: number) {
  try {
    return truncateChars(JSON.stringify(value), maxChars);
  } catch {
    return '[unserializable]';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workflowFromPlan(plan: TaskPlan) {
  return 'planned_workflow';
}

function nextActionFor(params: {
  approvalsCount: number;
  blockedCount: number;
  priorityCount: number;
  crmCount?: number;
  financeAlertCount?: number;
  mailCount?: number;
  calendarConflictCount?: number;
  browserBlockedCount?: number;
}) {
  if (params.approvalsCount > 0) {
    return '先处理待审批动作，避免高风险事项卡住执行队列。';
  }
  if (params.blockedCount > 0) {
    return '先解除阻塞事项；可以补充上下文、拒绝错误方向，或把任务拆小。';
  }
  if ((params.financeAlertCount ?? 0) > 0) {
    return '先处理财务提醒：逾期发票、即将扣费订阅或现金流风险通常会直接影响今天的经营动作。';
  }
  if ((params.mailCount ?? 0) > 0) {
    return '先处理紧急客户邮件和待确认外发动作；普通草稿和跟进任务会自动进入队列。';
  }
  if ((params.crmCount ?? 0) > 0) {
    return '优先推进客户跟进，先处理逾期跟进和高意向线索。';
  }
  if ((params.calendarConflictCount ?? 0) > 0) {
    return '先解决日程冲突，再准备今天和明天的重要会议。';
  }
  if ((params.browserBlockedCount ?? 0) > 0) {
    return '先审查被浏览器自动化拦截的高风险动作，再决定是否批准。';
  }
  if (params.priorityCount > 0) {
    return '推进今日优先任务；低风险事项会继续进入队列，高风险事项会先请求审批。';
  }
  return '补充一个新任务，或写入一条公司记忆，让系统积累上下文。';
}

function trimBlankLines(lines: string[]) {
  const copy = [...lines];
  while (copy.at(-1) === '') {
    copy.pop();
  }
  return copy;
}

function dashboardSection<T>(title: string, items: T[], render: (item: T, index: number) => string) {
  if (!items.length) return [];
  return [
    `${title}：`,
    ...items.map((item, index) => `${index + 1}. ${render(item, index)}`),
    ''
  ];
}

function parseOptionalPositiveInt(value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d+$/.test(value.trim())) return 'invalid' as const;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return 'invalid' as const;
  return parsed;
}

function parseOptionalBackupRowLimit(value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d+$/.test(value.trim())) return 'invalid' as const;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50000) return 'invalid' as const;
  return parsed;
}

function renderRetriableTask(task: TaskRecord) {
  return `${task.title}\n   ${task.id} / ${task.status} / owner:${task.owner_agent}`;
}

function renderRetryEvent(event: RetryEventRecord) {
  const task = event.task_id ? `task:${event.task_id}` : 'task:unknown';
  return `${event.status} / ${task}\n   ${event.id}${event.reason ? ` / ${event.reason}` : ''}`;
}

function renderIntegrationHealthCheck(check: IntegrationHealthCheckRecord) {
  return `${check.integration} / ${check.status}\n   ${check.id} / checked:${formatDateTime(check.checked_at)}`;
}

function renderAuditExport(record: AuditExportRecord) {
  const artifact = record.artifact_path ? ` / ${record.artifact_path}` : '';
  return `${record.scope} / ${record.format} / ${record.status}${artifact}\n   ${record.id}`;
}

function renderBackupRun(record: BackupRunRecord) {
  const artifact = record.artifact_path ? ` / ${record.artifact_path}` : '';
  const notes = record.notes ? `\n   ${record.notes}` : '';
  return `${record.backup_type} / ${record.status}${artifact}\n   ${record.id}${notes}`;
}

function renderEvaluationCase(record: EvaluationCaseRecord) {
  return `${record.name} / ${record.category} / ${record.status}\n   ${record.id}`;
}

function renderEvaluationRun(record: EvaluationRunRecord) {
  const summary = record.summary ?? {};
  const counts = typeof summary.totalCount === 'number'
    ? ` / pass:${summary.passedCount ?? 0} fail:${summary.failedCount ?? 0} skip:${summary.skippedCount ?? 0}`
    : '';
  return `${record.suite} / ${record.status}${counts}\n   ${record.id}`;
}

function renderPermissionProfile(profile: PermissionProfileRecord) {
  const approvals = profile.approval_required.length ? profile.approval_required.join(', ') : 'none';
  return `${profile.agent} / source:${profile.source}\n   approvals:${approvals}`;
}

function buildSettingsProfile(healthChecks: IntegrationHealthCheckRecord[]) {
  const language = process.env.DEFAULT_LANGUAGE || process.env.APP_LANGUAGE || 'zh-CN';
  const timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Shanghai';
  const env = process.env.APP_ENV || 'development';
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const browserDomains = process.env.BROWSER_ALLOWED_DOMAINS || 'stripe.com,github.com,google.com';
  const latestByIntegration = new Map<string, IntegrationHealthCheckRecord>();

  for (const check of healthChecks) {
    if (!latestByIntegration.has(check.integration)) {
      latestByIntegration.set(check.integration, check);
    }
  }

  const integrations = ['postgres', 'redis', 'telegram', 'ai', 'email', 'calendar', 'finance', 'browser'].map((integration) => {
    const latest = latestByIntegration.get(integration);
    if (!latest) return `${integration} / unknown`;
    return `${integration} / ${latest.status}`;
  });

  integrations.push(`browser_allowed_domains / ${browserDomains}`);

  return {
    env,
    timezone,
    publicBaseUrl,
    language,
    integrations
  };
}

function defaultApprovalBoundary() {
  return [
    '普通方案分析、客户挖掘、CRM 写入、单封邮件和邮件 campaign 发送默认自动处理。',
    '付款、退款、转账、取消订阅、报税、真实开票和账单修改必须审批。',
    '购买线索/数据源、广告投放、非邮件批量触达和提交外部网页表单必须审批。',
    '生产部署、密钥变更、生产数据写入和破坏性操作必须审批。',
    '读取、总结、分类、内部记账、报价草案和任务规划通常可以自动处理。'
  ];
}

function renderBriefFollowUp(followUp: FollowUpRecord) {
  const owner = followUp.contact_name ?? followUp.organization_name ?? followUp.contact_id;
  const due = followUp.due_at ? ` / due:${formatDate(followUp.due_at)}` : '';
  return `${owner} / ${followUp.priority}${due}\n   ${followUp.note}`;
}

function renderBriefContact(contact: ContactRecord) {
  const org = contact.organization_name ? ` / ${contact.organization_name}` : '';
  const note = contact.notes ? `\n   ${firstLine(contact.notes)}` : '';
  return `${contact.name}${org} / ${contact.status}${note}`;
}

function renderEmailThread(thread: EmailThreadRecord) {
  const owner = thread.contact_name ?? thread.organization_name ?? thread.contact_id ?? '未知联系人';
  return `${thread.subject} / ${owner}\n   ${thread.id} / ${thread.status} / ${thread.category}`;
}

function renderEmailDraft(draft: EmailDraftRecord) {
  const approval = draft.approval_id ? ` / approval:${draft.approval_id}` : '';
  return `${draft.subject}\n   ${draft.id} / ${draft.status}${approval}`;
}

function renderInvoice(invoice: InvoiceRecord) {
  const due = invoice.due_at ? ` / due:${formatDate(invoice.due_at)}` : '';
  return `${invoice.customer_name} ${formatMoney(Number(invoice.amount), invoice.currency)}\n   ${invoice.id} / ${invoice.status}${due}`;
}

function renderSubscription(subscription: SubscriptionRecord) {
  const next = subscription.next_billing_at ? ` / next:${formatDate(subscription.next_billing_at)}` : '';
  const vendor = subscription.vendor_name ?? subscription.name;
  return `${vendor} ${formatMoney(Number(subscription.amount), subscription.currency)}\n   ${subscription.id} / ${subscription.billing_interval}${next}`;
}

function renderTransaction(transaction: TransactionRecord) {
  const counterparty = transaction.counterparty ? ` / ${transaction.counterparty}` : '';
  return `${transaction.direction} ${formatMoney(Number(transaction.amount), transaction.currency)}${counterparty}\n   ${transaction.id} / ${formatDate(transaction.occurred_at)}`;
}

function renderCalendarEvent(event: CalendarEventRecord) {
  const attendees = event.attendees.length ? ` / ${event.attendees.join(', ')}` : '';
  const location = event.location ? ` / ${event.location}` : '';
  return `${formatTime(event.starts_at)}-${formatTime(event.ends_at)} ${event.title}${attendees}${location}\n   ${event.id} / ${event.status}`;
}

function renderAvailabilityWindow(window: AvailabilityWindowRecord) {
  return `${formatTime(window.starts_at)}-${formatTime(window.ends_at)} / ${window.status}`;
}

function renderMeetingPrep(note: MeetingNoteRecord) {
  const event = note.event_title ? `${note.event_title} / ` : '';
  const startsAt = note.event_starts_at ? `${formatDateTime(note.event_starts_at)}\n   ` : '';
  return `${event}${note.id}\n   ${startsAt}${firstLine(note.content)}`;
}

function renderBrowserRun(run: BrowserRunRecord) {
  return `${run.target_domain} / ${run.status}\n   ${run.id} / ${run.target_url}`;
}

function renderBrowserBlockedAction(action: BrowserBlockedActionRecord) {
  const approval = action.approval_id ? ` / approval:${action.approval_id}` : '';
  return `${action.action_type} / ${action.status}${approval}\n   ${action.id} / ${action.reason}`;
}

function renderBrowserScreenshot(screenshot: BrowserScreenshotRecord) {
  return `${screenshot.label} / ${screenshot.status}\n   ${screenshot.id} / run:${screenshot.run_id}`;
}

function renderBrowserExtraction(extraction: BrowserExtractionRecord) {
  return `${extraction.extraction_type} / ${extraction.status}\n   ${extraction.id} / run:${extraction.run_id}`;
}

function toHandoffContext(result: AgentRunResult) {
  return {
    runId: result.runId,
    agentId: result.agentId,
    provider: result.provider,
    model: result.model,
    toolCalls: result.toolCalls.map((tool) => ({
      name: tool.name,
      status: tool.status
    })),
    content: result.content.slice(0, 2000)
  };
}

const SPECIALIST_HANDOFF_AGENT_IDS = new Set([
  'solution',
  'research',
  'prospecting',
  'quote',
  'crm',
  'email',
  'calendar',
  'finance',
  'browser',
  'content',
  'dev',
  'ops'
]);

function shouldAskChiefIntentAI(intake: ReturnType<typeof intakeMessage>) {
  const text = intake.normalizedText.trim();
  if (!text || intake.kind === 'empty' || intake.kind === 'command') return false;
  return text.length <= 4000;
}

function buildChiefIntentPrompt(intake: ReturnType<typeof intakeMessage>) {
  return [
    '你是 Tele-OPC OS 的 Chief Agent 意图分类器。',
    '任务：判断这条 Telegram 自然语言消息应该进入哪个路由。所有普通文本都必须由你分类。只输出 JSON，不要输出 Markdown。',
    '',
    '可选 route：',
    '- question：用户在问状态、上下文、解释、诊断、方案或让 Chief 思考，不应该新建普通任务',
    '- progress：用户在催促、查询进度、问任务推进情况，不应该新建任务',
    '- continuation：用户在确认继续执行上一条任务或上一条建议',
    '- content：用户明确要生成内容草稿、文章、社媒文案、脚本等',
    '- domain_record：用户要记录或打开某个业务域数据，例如 CRM、邮件、财务、日历、浏览器、公司记忆或看板',
    '- task：用户明确要创建、执行、排查、开发、研究、挖掘、规划一个新工作项',
    '- unknown：信息不足，无法判断',
    '',
    'domain_record 时可选 targetWorkflow：memory、crm、email、mail_dashboard、finance、finance_dashboard、calendar、calendar_dashboard、browser、browser_dashboard、solution、prospecting、quote、review、dev、ops、market_scan、unknown。',
    'targetWorkflow 用 market_scan 的判断标准：用户在问"哪个方向/赛道/市场现在能挣钱""该做什么生意""怎么最快挣到钱""有什么机会"，也就是还没确定卖什么、需要先侦察市场。注意与 prospecting 区分：prospecting 是已经知道卖什么、要去找买家名单；market_scan 是还不知道该卖什么。',
    'task 或 content 如有明显业务方向，也可以填写 targetWorkflow，例如 prospecting、solution、dev、quote、content 不在 targetWorkflow 可填 unknown。',
    '',
    '重要规则：',
    '- “继续/推进/开始执行/怎么没回复/怎么样了/任务到哪了”优先判为 continuation 或 progress，不要判为 task。',
    '- “还有什么任务需要推进/刚刚那个任务/最近上下文里有没有...”是 question 或 progress，不要判为 task。',
    '- 涉及付款、报价确认、广告投放、付费数据源、外部提交、发布、生产部署、删除时仍可分类，但执行层会另做审批。',
    '',
    '输出格式：{"route":"progress","confidence":0.82,"targetWorkflow":"prospecting","reason":"..."}',
    '',
    '用户消息：',
    intake.normalizedText
  ].join('\n');
}

function parseChiefIntentDecision(content: string): ChiefIntentDecision | null {
  const parsed = parseJsonObjectFromText(content);
  if (!parsed) return null;
  const route = typeof parsed.route === 'string' ? parsed.route.trim().toLowerCase() : '';
  if (!isChiefIntentRoute(route)) return null;
  const rawConfidence = typeof parsed.confidence === 'number'
    ? parsed.confidence
    : typeof parsed.confidence === 'string'
      ? Number(parsed.confidence)
      : 0;
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  return {
    route,
    confidence,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : undefined,
    targetWorkflow: parseChiefIntentTargetWorkflow(parsed.targetWorkflow)
  };
}

function isChiefIntentRoute(value: string): value is ChiefIntentRoute {
  return ['question', 'task', 'continuation', 'progress', 'content', 'domain_record', 'unknown'].includes(value);
}

function parseChiefIntentTargetWorkflow(value: unknown): ChiefIntentTargetWorkflow | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    [
      'memory',
      'crm',
      'email',
      'mail_dashboard',
      'finance',
      'finance_dashboard',
      'calendar',
      'calendar_dashboard',
      'browser',
      'browser_dashboard',
      'solution',
      'prospecting',
      'quote',
      'review',
      'dev',
      'ops',
      'market_scan',
      'unknown'
    ].includes(normalized)
  ) {
    return normalized as ChiefIntentTargetWorkflow;
  }
  return 'unknown';
}

function parseJsonObjectFromText(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function specialistHandoffPlanFromChiefRun(result: AgentRunResult): SpecialistHandoffPlan | null {
  const toolCall = result.toolCalls.find((tool) => tool.name === 'plan_specialist_handoff' && tool.status === 'done');
  if (!toolCall) return null;
  const output = toolCall?.output;
  if (!isRecord(output) || !Array.isArray(output.agents)) return null;

  const agents = output.agents
    .map((item) => normalizeSpecialistAgent(item))
    .filter((item): item is SpecialistHandoffPlan['agents'][number] => Boolean(item))
    .slice(0, 6);

  if (!agents.length) return null;

  return {
    goal: typeof output.goal === 'string' ? output.goal : result.content.slice(0, 240),
    executionMode: output.executionMode === 'sequence' ? 'sequence' : 'parallel',
    agents,
    reason: typeof output.reason === 'string' ? output.reason : undefined,
    sourceToolCallId: toolCall.id
  };
}

function mergeProspectingCandidates(
  primary: ProspectingLeadCandidate[],
  fallback: ProspectingLeadCandidate[],
  limit: number
) {
  const seen = new Set<string>();
  const merged: ProspectingLeadCandidate[] = [];
  for (const candidate of [...primary, ...fallback]) {
    const key = candidate.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
    if (merged.length >= limit) break;
  }
  return merged;
}

function normalizeSpecialistAgent(value: unknown): SpecialistHandoffPlan['agents'][number] | null {
  const agentId = typeof value === 'string'
    ? value
    : isRecord(value) && typeof value.agentId === 'string'
      ? value.agentId
      : null;
  if (!agentId || !SPECIALIST_HANDOFF_AGENT_IDS.has(agentId)) return null;

  return {
    agentId,
    name: isRecord(value) && typeof value.name === 'string' ? value.name : undefined,
    role: isRecord(value) && typeof value.role === 'string' ? value.role : undefined,
    reason: isRecord(value) && typeof value.reason === 'string' ? value.reason : undefined
  };
}

function isContinuationOnly(text: string) {
  return /^(继续|继续吧|执行|执行吧|启动|启动吧|开始|开始吧|确认|可以|好|好的|行|同意|推进|推进吧|推进呀|继续执行|开始执行|开始执行吧|现在启动|现在执行|现在推进)$/i.test(text.trim());
}

function isProgressNudge(text: string) {
  const normalized = text.trim();
  if (normalized.length > 80) return false;
  if (/^(推进|推进吧|推进呀|继续|继续吧|执行吧|启动吧|开始吧|开始执行吧)$/i.test(normalized)) return true;
  return /(没回复|没有回复|不回复|卡住|还在跑|还在执行|什么状态|怎么样了|进度)/i.test(normalized);
}

function isNudgeOnlyTask(task: TaskRecord) {
  const text = `${task.title}\n${task.description ?? ''}`.trim();
  return /^(继续|继续吧|执行|执行吧|启动|启动吧|开始|开始吧|推进|推进吧|推进呀|开始执行吧|现在推进|推进呀[，, ]*怎么(没有|没)回复了[？?]?|.*怎么(没有|没)回复了[？?]?)$/i.test(text);
}

function latestRunsByStatus(runs: AgentRunRecord[], status: string) {
  return runs
    .filter((run) => run.status === status)
    .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
}

function isContinuationPrompt(text: string) {
  return /回复[「"“']?(继续|执行|启动|确认|可以)|只需回复|是否.*(启动|执行|继续)|是否需要我.*(执行|启动|调度)|现在启动|发起执行调度/i.test(text);
}

function requiresExplicitApprovalContinuation(text: string) {
  return /审批 ID|\/approve|\/reject|等待审批|批准.*审批|拒绝.*审批/i.test(text);
}

function continuationOwnerPreference(promptText: string) {
  if (/Seq\s*1|第一步|起点|ICP|排除条件/i.test(promptText)) return ['icp', 'research', 'prospecting'];
  if (/Research Agent|公开搜索|搜索抓取|抓取|搜集|公开情报|来源证据/i.test(promptText)) return ['research', 'prospecting', 'icp'];
  if (/评分|补全|线索评分/i.test(promptText)) return ['lead_scoring', 'prospecting'];
  if (/CRM|写入 CRM|管道/i.test(promptText)) return ['crm'];
  if (/sequence|触达草稿|Sales Sequence/i.test(promptText)) return ['sales_sequence'];
  if (/客户挖掘|Prospecting|获客|线索/i.test(promptText)) return ['icp', 'prospecting', 'research', 'lead_scoring', 'sales_sequence', 'crm'];
  return ['research', 'icp', 'prospecting', 'lead_scoring', 'sales_sequence', 'crm'];
}

function buildContinuationText(confirmationText: string, promptText: string, priorMessages: RecentChatMessage[]) {
  const recentContext = priorMessages
    .slice(0, 8)
    .reverse()
    .map((message) => `${message.direction}: ${firstLine(message.text ?? '').slice(0, 500)}`)
    .join('\n');

  return [
    `用户回复了短确认词：“${confirmationText}”。`,
    '请基于上一条系统消息和最近对话继续，不要把短确认词当作无上下文新问题。',
    '',
    '上一条可续接系统消息：',
    promptText.slice(0, 3000),
    '',
    '最近对话摘要：',
    recentContext
  ].join('\n');
}

function isContentCreationRequest(text: string) {
  const normalized = text.trim();
  if (/邮件|email|报价|合同|发票|会议|日程/.test(normalized)) return false;
  return /内容|文案|文章|公众号|小红书|抖音|视频脚本|短视频|种草|推文|帖子|社媒|博客|HTML|html|网页|介绍页|落地页|官网|landing page|web page|campaign copy|content|PPT|ppt|幻灯片|演示文稿|presentation|slide deck|slides/i.test(normalized);
}

function isPresentationCreationRequest(text: string) {
  return /PPT|ppt|幻灯片|演示文稿|presentation|slide deck|slides/i.test(text);
}

function renderAgentContentForTelegram(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return '模型已返回空内容，任务会继续进入 worker 生成可追踪结果。';
  if (looksLikeCodeDeliverable(trimmed)) {
    return '模型已生成代码/HTML 类交付内容；Telegram 不直接刷整段代码，完整结果会作为任务交付物和网页预览打开。';
  }
  if (trimmed.length > 1200) {
    return `${trimmed.slice(0, 1200)}\n\n内容较长，后续会沉淀到任务结果或交付物中。`;
  }
  return trimmed;
}

function looksLikeCodeDeliverable(content: string) {
  return /```(?:html|css|js|javascript|tsx?|jsx?)|<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<style[\s>]/i.test(content);
}

function formatMoney(amount: number, currency: string) {
  const rounded = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
  if (currency === 'CNY') return `¥${rounded}`;
  if (currency === 'USD') return `$${rounded}`;
  return `${rounded} ${currency}`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 10)} ${formatTime(value)}`;
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(parsed);
}

function firstLine(value: string) {
  return value.split('\n')[0] ?? value;
}

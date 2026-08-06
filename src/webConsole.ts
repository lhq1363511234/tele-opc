import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentRunner } from './ai/agentRunner.js';
import { ApprovalService } from './approvals/service.js';
import { createModelProviderFromConfig } from './ai/modelProvider.js';
import { listAgentDefinitions } from './agents/registry.js';
import { ChiefOfStaff } from './brain/chiefOfStaff.js';
import type { AppConfig } from './config/index.js';
import type { Repositories } from './db/repositories.js';
import { pingDatabase } from './db/pool.js';
import { pingRedis } from './db/redis.js';
import { BullMqTaskDispatcher } from './queue/taskQueue.js';
import { TelegramClient } from './telegram/client.js';
import type { TelegramChat, TelegramMessage, TelegramUser } from './telegram/types.js';
import { buildTaskDetailCard } from './telegram/ux.js';
import type { ArtifactRecord, TaskRecord, TaskStatus } from './types.js';
import { createWebConsoleAuthPreHandler, resolveWebConsoleAuthMode } from './web/auth.js';
import { getTelegramInitDataValidation } from './web/telegramInitData.js';
import { CustomerEmailSender } from './email/campaignEmailSender.js';
import { buildFeishuMirror } from './appos/feishu/ledger-mirror.js';
import { LedgerSync } from './appos/feishu/ledger-sync.js';
import { buildBusinessAnalytics } from './web/analytics.js';
import { registerPaperclipWebRoutes } from './integrations/paperclip/web-routes.js';
import { registerASelfWebRoutes, registerASelfActionsRoutes } from './a-self/web-routes.js';
import { registerBusinessActionRoutes } from './web/actions-routes.js';
import { registerPaymentRoutes } from './web/payment-routes.js';
import { registerStudioRoutes } from './web/studio-routes.js';
import { registerWechatIlinkWebRoutes } from './channels/wechat-ilink/web-routes.js';
import { registerPersonalWechatBridgeRoutes } from './channels/personal-wechat/routes.js';
import { pool } from './db/pool.js';
import { MetaAgentStore } from './meta-agent/store.js';
import { MetaAgentEvolutionService } from './meta-agent/service.js';
import { registerMetaAgentWebRoutes } from './meta-agent/web-routes.js';

const apiLimitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const taskQuerySchema = apiLimitSchema.extend({
  status: z.string().optional()
});

const commandSchema = z.object({
  text: z.string().trim().min(1).max(8000)
});

const miniAppSubmitSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(8000),
  values: z.record(z.string()).optional()
});

const retrySchema = z.object({
  reason: z.string().trim().max(500).optional()
});

const feishuSyncSchema = z.object({
  taskLimit: z.coerce.number().int().min(1).max(200).optional(),
  approvalLimit: z.coerce.number().int().min(1).max(200).optional(),
  leadLimit: z.coerce.number().int().min(1).max(200).optional(),
  artifactLimit: z.coerce.number().int().min(1).max(200).optional()
});

function validateWebInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  reply: FastifyReply
): { ok: true; data: z.infer<TSchema> } | { ok: false; response: { ok: false; error: string; issues: Array<{ path: string; message: string }> } } {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  reply.code(400);
  return {
    ok: false,
    response: {
      ok: false,
      error: 'invalid_request',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    }
  };
}

const validTaskStatuses: TaskStatus[] = [
  'new',
  'intake',
  'planned',
  'waiting_approval',
  'queued',
  'running',
  'waiting_external',
  'blocked',
  'review',
  'done',
  'cancelled',
  'failed'
];

type WebCommandResult = {
  reply: string;
  messageId: string;
  task?: TaskRecord;
  currentTask?: TaskRecord;
  subtasks?: TaskRecord[];
  artifacts?: ArtifactRecord[];
};

export function registerWebConsole(app: FastifyInstance<any, any, any, any>, config: AppConfig, repos: Repositories) {
  const modelProvider = createModelProviderFromConfig(config);
  const taskDispatcher = new BullMqTaskDispatcher(config.redis.url);
  const approvalService = new ApprovalService(config, repos, taskDispatcher);
  const agentRunner = modelProvider ? new AgentRunner(modelProvider, repos, approvalService) : null;
  const brain = new ChiefOfStaff(
    repos,
    taskDispatcher,
    undefined,
    undefined,
    undefined,
    undefined,
    agentRunner,
    undefined,
    approvalService
  );

  const allowWebConsoleAccess = createWebConsoleAuthPreHandler(config);
  const authMode = resolveWebConsoleAuthMode(config);
  const metaAgentService = modelProvider
    ? new MetaAgentEvolutionService(modelProvider, new MetaAgentStore(pool))
    : null;
  const customerEmailSender = CustomerEmailSender.fromEnv();
  registerPaperclipWebRoutes(app, config, repos, allowWebConsoleAccess);
  registerASelfWebRoutes(app, config, repos, allowWebConsoleAccess);
  registerASelfActionsRoutes(app, config, repos, allowWebConsoleAccess);
  registerBusinessActionRoutes(app, repos, approvalService, allowWebConsoleAccess);
  registerPaymentRoutes(app, config, repos, allowWebConsoleAccess);
  registerStudioRoutes(app, config, repos, allowWebConsoleAccess);
  registerWechatIlinkWebRoutes(app, config, repos, allowWebConsoleAccess);
  registerPersonalWechatBridgeRoutes(app, config, repos, allowWebConsoleAccess);
  registerMetaAgentWebRoutes(app, metaAgentService, allowWebConsoleAccess);

  app.get('/api/web/session', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    app: {
      name: config.app.name,
      env: config.app.env,
      timezone: config.app.timezone
    },
    auth: {
      mode: authMode,
      required: authMode === 'telegram'
    }
  }));

  app.get('/api/web/telegram-diagnostics', async (request) => {
    const initData = getTelegramInitDataValidation(request, config);
    return {
      ok: true,
      publicBaseUrl: config.app.publicBaseUrl,
      httpsPublicBaseUrl: config.app.publicBaseUrl.startsWith('https://'),
      botTokenConfigured: Boolean(config.telegram.botToken && config.telegram.botToken !== 'change-me'),
      ownerIdsConfigured: config.telegram.ownerIds.length,
      initData: {
        present: initData.present,
        valid: initData.valid,
        reason: initData.reason,
        userId: initData.userId,
        ownerAllowed: initData.ownerAllowed,
        authDate: initData.authDate,
        ageSeconds: initData.ageSeconds,
        queryIdPresent: Boolean(initData.queryId),
        startParam: initData.startParam
      },
      request: {
        url: request.url,
        host: request.headers.host,
        userAgent: request.headers['user-agent'] ?? null
      }
    };
  });

  app.get('/api/web/overview', { preHandler: allowWebConsoleAccess }, async () => {
    const [
      database,
      redis,
      tasks,
      pendingApprovals,
      agentRuns,
      recentMessages,
      codexInbox,
      crm,
      mail,
      finance,
      calendar,
      browser,
      ops
    ] = await Promise.all([
      pingDatabase(),
      pingRedis(),
      repos.listTasks(60),
      repos.listPendingApprovals(20),
      repos.listAgentRuns(20),
      repos.listRecentMessages(12),
      readCodexInbox(config.codexBridge.inboxPath),
      repos.getCrmDashboard(),
      repos.getMailDashboard(),
      repos.getFinanceDashboard(),
      repos.getCalendarDashboard(),
      repos.getBrowserDashboard(),
      repos.getOpsDashboard()
    ]);

    const taskStatusCounts = tasks.reduce<Record<string, number>>((counts, task) => {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
      return counts;
    }, {});
    const runningAgentRuns = agentRuns.filter((run) => run.status === 'running').length;

    return {
      ok: true,
      health: { database, redis },
      metrics: {
        tasks: tasks.length,
        runningAgentRuns,
        pendingApprovals: pendingApprovals.length,
        blockedTasks: taskStatusCounts.blocked ?? 0,
        queuedTasks: taskStatusCounts.queued ?? 0,
        activeAgents: new Set(agentRuns.map((run) => run.agent_id)).size
      },
      taskStatusCounts,
      tasks: tasks.slice(0, 12),
      pendingApprovals,
      agentRuns: agentRuns.slice(0, 10),
      recentMessages,
      codexInbox,
      dashboards: {
        crm,
        mail,
        finance,
        calendar,
        browser,
        ops
      }
    };
  });

  app.get('/api/web/agents', { preHandler: allowWebConsoleAccess }, async () => {
    const [agentRuns, pendingApprovals] = await Promise.all([
      repos.listAgentRuns(60),
      repos.listPendingApprovals(20)
    ]);
    return {
      ok: true,
      agents: listAgentDefinitions().map((agent) => {
        const latestRun = agentRuns.find((run) => run.agent_id === agent.id);
        return {
          ...agent,
          latestRun,
          runCount: agentRuns.filter((run) => run.agent_id === agent.id).length,
          pendingApprovalCount: pendingApprovals.filter((approval) => approval.action_type.includes(agent.id)).length
        };
      })
    };
  });

  app.get('/api/web/agent-runs', { preHandler: allowWebConsoleAccess }, async (request) => {
    const query = apiLimitSchema.parse(request.query);
    return {
      ok: true,
      agentRuns: await repos.listAgentRuns(query.limit)
    };
  });

  app.get<{ Params: { id: string } }>('/api/web/agent-runs/:id', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const run = await repos.getAgentRun(request.params.id);
    if (!run) {
      reply.code(404);
      return { ok: false, error: 'agent_run_not_found' };
    }
    return {
      ok: true,
      run,
      toolCalls: await repos.listToolCallsForAgentRun(run.id)
    };
  });

  app.get('/api/web/tasks', { preHandler: allowWebConsoleAccess }, async (request) => {
    const query = taskQuerySchema.parse(request.query);
    const statuses = query.status
      ?.split(',')
      .map((status) => status.trim())
      .filter((status): status is TaskStatus => validTaskStatuses.includes(status as TaskStatus));

    return {
      ok: true,
      tasks: statuses?.length
        ? (await repos.listTasksByStatuses(statuses, query.limit)).filter((task) => task.parent_task_id === null)
        : await repos.listTopLevelTasks(query.limit)
    };
  });

  app.get<{ Params: { id: string } }>('/api/web/tasks/:id', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const snapshot = await taskSnapshotForTaskId(repos, request.params.id);
    if (!snapshot) {
      reply.code(404);
      return { ok: false, error: 'task_not_found' };
    }
    return { ok: true, ...snapshot };
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/web/tasks/:id/retry',
    { preHandler: allowWebConsoleAccess },
    async (request) => {
      const body = retrySchema.parse(request.body ?? {});
      const result = await submitWebCommand(brain, repos, config, `/retry ${request.params.id}${body.reason ? ` ${body.reason}` : ''}`);
      return result;
    }
  );

  app.get('/api/web/approvals', { preHandler: allowWebConsoleAccess }, async (request) => {
    const query = apiLimitSchema.parse(request.query);
    return {
      ok: true,
      approvals: await repos.listPendingApprovals(query.limit)
    };
  });

  app.get('/api/web/crm', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getCrmDashboard()
  }));

  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    '/api/web/crm/lead-list',
    { preHandler: allowWebConsoleAccess },
    async (request) => {
      const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
      const offset = Math.max(0, Number(request.query.offset) || 0);
      const query = request.query.q?.trim() || undefined;
      const result = await repos.searchLeads({ query, limit, offset });
      return { ok: true, limit, offset, query: query ?? '', ...result };
    }
  );

  app.get('/api/web/mail', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getMailDashboard()
  }));


  app.get('/api/web/mail/smtp-status', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    smtp: customerEmailSender.getStatus(),
    capabilities: {
      campaignSend: true,
      singleCustomerSend: true,
      command: '/send_campaign <campaign_id>',
      api: 'POST /api/web/mail/send'
    }
  }));

  app.post<{ Body: unknown }>('/api/web/mail/send', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const parsed = z.object({
      to: z.union([z.string(), z.array(z.string())]),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string().trim().min(1, 'subject_required'),
      text: z.string().default(''),
      html: z.string().nullish().transform(v => v ?? undefined),
      from: z.string().optional()
    }).safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: 'validation_failed',
        reason: 'invalid_payload',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      };
    }
    const body = parsed.data;

    const result = await customerEmailSender.sendCustomerEmail(body);
    if (!result.ok) {
      reply.code(result.reason === 'smtp_not_configured' ? 503 : 400);
      return result;
    }

    await repos.audit({
      actorType: 'web_console',
      action: 'customer_email_sent',
      entityType: 'mail',
      entityId: result.messageId,
      metadata: {
        to: result.to,
        cc: result.cc,
        subject: result.subject,
        from: result.from
      }
    });

    return result;
  });


  app.get('/api/web/finance', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getFinanceDashboard(),
    policy: {
      approvalRequired: ['payment', 'refund', 'transfer', 'tax_filing', 'billing_change', 'financial_commitment']
    }
  }));

  app.get('/api/web/calendar', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getCalendarDashboard()
  }));

  app.get('/api/web/browser', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getBrowserDashboard()
  }));

  app.get('/api/web/ops', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getOpsDashboard()
  }));

  app.get('/api/web/architecture', { preHandler: allowWebConsoleAccess }, async (_request, reply) => {
    try {
      const catalogPath = path.resolve(process.cwd(), 'docs', 'architecture', 'module-catalog.yaml');
      const parsed = YAML.parse(await fs.readFile(catalogPath, 'utf8')) as {
        version?: number;
        updated_at?: string;
        modules?: unknown[];
      };
      return {
        ok: true,
        version: parsed.version ?? 1,
        updatedAt: parsed.updated_at ?? '',
        modules: Array.isArray(parsed.modules) ? parsed.modules : []
      };
    } catch (error) {
      reply.code(500);
      return { ok: false, error: 'architecture_catalog_unavailable', message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get('/api/web/settings', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    settings: {
      ai: {
        provider: config.ai.provider,
        model: config.ai.openaiModel,
        agentEnabled: config.ai.agentEnabled,
        baseUrlConfigured: Boolean(config.ai.openaiBaseUrl),
        apiKeyConfigured: Boolean(config.ai.openaiApiKey)
      },
      telegram: {
        ownerIdsConfigured: config.telegram.ownerIds.length,
        webhookSecretConfigured: Boolean(config.telegram.webhookSecret),
        botTokenConfigured: Boolean(config.telegram.botToken && config.telegram.botToken !== 'change-me')
      },
      codexBridge: {
        enabled: config.codexBridge.enabled,
        mode: config.codexBridge.mode,
        inboxPath: config.codexBridge.inboxPath
      },
      webConsole: {
        auth: authMode,
        required: authMode === 'telegram',
        devTokenConfigured: Boolean(config.webConsole.devToken)
      },
      publicBaseUrl: config.app.publicBaseUrl
    }
  }));

  app.get('/api/web/analytics', { preHandler: allowWebConsoleAccess }, async () => buildBusinessAnalytics(config));

  app.get('/api/web/ops-insights', { preHandler: allowWebConsoleAccess }, async () => {
    const [tasks, pendingApprovals, leads, agentRuns, crm, mail, finance] = await Promise.all([
      repos.listTasks(200),
      repos.listPendingApprovals(50),
      repos.listProspectingLeads(100),
      repos.listAgentRuns(50),
      repos.getCrmDashboard(),
      repos.getMailDashboard(),
      repos.getFinanceDashboard()
    ]);

    const countBy = <T,>(items: T[], keyFn: (item: T) => string) => {
      const out: Record<string, number> = {};
      for (const item of items) {
        const key = keyFn(item) || 'unknown';
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    };

    const taskStatus = countBy(tasks, (t) => t.status);
    const taskPriority = countBy(tasks, (t) => t.priority || 'normal');
    const taskOwner = countBy(tasks, (t) => t.owner_agent || 'unknown');
    const leadStatus = countBy(leads, (t) => t.status || 'unknown');
    const leadSource = countBy(leads, (t) => t.source || 'unknown');

    const dayKey = (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'unknown';
      return d.toISOString().slice(0, 10);
    };
    const taskTrendMap = countBy(tasks, (t) => dayKey(t.created_at));
    const leadTrendMap = countBy(leads, (t) => dayKey(t.created_at));
    const days = Array.from(new Set([...Object.keys(taskTrendMap), ...Object.keys(leadTrendMap)]))
      .filter((d) => d !== 'unknown')
      .sort()
      .slice(-14);
    const trend = days.map((day) => ({
      day,
      tasks: taskTrendMap[day] ?? 0,
      leads: leadTrendMap[day] ?? 0
    }));

    const scoreOf = (lead: typeof leads[number]) => {
      const score = lead.score as Record<string, unknown> | null;
      if (!score) return null;
      if (typeof score.total === 'number') return score.total;
      if (typeof score.score === 'number') return score.score;
      return null;
    };

    const scored = leads
      .map((lead) => ({ lead, score: scoreOf(lead) }))
      .filter((x): x is { lead: typeof leads[number]; score: number } => typeof x.score === 'number')
      .sort((a, b) => b.score - a.score);

    const blocked = tasks.filter((t) => t.status === 'blocked' || t.status === 'failed').slice(0, 8);
    const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued').slice(0, 8);
    const hotLeads = (crm.hotLeads ?? []).slice(0, 6);
    const overdue = (crm.overdueFollowUps ?? []).slice(0, 6);
    const urgentMail = ((mail as any).urgent ?? []).slice(0, 5);

    const headlineParts: string[] = [];
    if ((pendingApprovals.length ?? 0) > 0) headlineParts.push(`${pendingApprovals.length} 个审批待处理`);
    if ((taskStatus.blocked ?? 0) > 0) headlineParts.push(`${taskStatus.blocked} 个任务阻塞`);
    if ((crm.overdueFollowUps ?? []).length > 0) headlineParts.push(`${(crm.overdueFollowUps ?? []).length} 个跟进逾期`);
    if ((crm.hotLeads ?? []).length > 0) headlineParts.push(`${(crm.hotLeads ?? []).length} 条热线索`);
    if (headlineParts.length === 0) headlineParts.push('经营面平稳，可推进新机会');

    const kpis = [
      { key: 'tasks', label: '任务总量', value: tasks.length, hint: `运行 ${taskStatus.running ?? 0} / 阻塞 ${taskStatus.blocked ?? 0}` , tone: (taskStatus.blocked ?? 0) > 0 ? 'danger' : 'ok' },
      { key: 'approvals', label: '待审批', value: pendingApprovals.length, hint: '需要你拍板的事项', tone: pendingApprovals.length > 0 ? 'warn' : 'ok' },
      { key: 'leads', label: '线索总量', value: leads.length, hint: `热线索 ${(crm.hotLeads ?? []).length}`, tone: 'ok' },
      { key: 'agents', label: 'Agent 运行', value: agentRuns.length, hint: `进行中 ${agentRuns.filter((r) => r.status === 'running').length}`, tone: 'ok' },
      { key: 'overdue', label: '逾期跟进', value: (crm.overdueFollowUps ?? []).length, hint: 'CRM 跟进压力', tone: (crm.overdueFollowUps ?? []).length > 0 ? 'danger' : 'ok' },
      { key: 'cash', label: '财务关注', value: Number((finance as any).openInvoices?.length ?? (finance as any).riskCount ?? 0), hint: '未结/风险相关条目', tone: 'warn' }
    ];

    const actions = [
      ...pendingApprovals.slice(0, 3).map((a) => ({ kind: 'approval', title: a.prompt?.slice(0, 80) || a.action_type, detail: `审批 ${a.status}`, href: '/app/settings' })),
      ...blocked.slice(0, 3).map((t) => ({ kind: 'task', title: t.title, detail: `状态 ${t.status}`, href: `/app/tasks?task=${encodeURIComponent(t.id)}` })),
      ...overdue.slice(0, 2).map((f: any) => ({ kind: 'crm', title: f.title || f.name || '逾期跟进', detail: 'CRM 逾期', href: '/app/crm' })),
      ...scored.slice(0, 2).map((x) => ({ kind: 'lead', title: x.lead.name, detail: `分数 ${x.score}`, href: '/app/crm' }))
    ].slice(0, 8);

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      headline: headlineParts.join(' · '),
      kpis,
      distributions: {
        taskStatus,
        taskPriority,
        taskOwner,
        leadStatus,
        leadSource
      },
      trend,
      lists: {
        blockedTasks: blocked,
        activeTasks: running,
        hotLeads,
        topScoredLeads: scored.slice(0, 8).map((x) => ({ ...x.lead, score_total: x.score })),
        overdueFollowUps: overdue,
        urgentMail,
        pendingApprovals: pendingApprovals.slice(0, 8)
      },
      actions,
      feishu: {
        baseUrl: config.feishu.baseAppToken ? `https://opcto-a1.feishu.cn/base/${config.feishu.baseAppToken}` : null,
        tables: {
          tasks: '经营任务',
          leads: '经营线索',
          approvals: '审批',
          artifacts: '交付物'
        }
      }
    };
  });

  app.get('/api/web/feishu/status', { preHandler: allowWebConsoleAccess }, async () => {
    const f = config.feishu;
    const credentialsConfigured = Boolean(f.appId && f.appSecret && f.baseAppToken);
    return {
      ok: true,
      feishu: {
        mirrorEnabled: f.mirrorEnabled,
        autoSyncIntervalMs: f.autoSyncIntervalMs,
        credentialsConfigured,
        mode: credentialsConfigured ? 'openapi' : 'noop',
        baseAppTokenConfigured: Boolean(f.baseAppToken),
        appIdConfigured: Boolean(f.appId),
        appSecretConfigured: Boolean(f.appSecret),
        openBaseUrl: f.openBaseUrl,
        baseUrl: f.baseAppToken ? `https://opcto-a1.feishu.cn/base/${f.baseAppToken}` : null
      }
    };
  });

  app.post<{ Body: unknown }>('/api/web/feishu/sync', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const body = validateWebInput(feishuSyncSchema, request.body ?? {}, reply);
    if (!body.ok) return body.response;
    const f = config.feishu;
    const mirror = buildFeishuMirror({
      publicBaseUrl: config.app.publicBaseUrl,
      appId: f.appId || undefined,
      appSecret: f.appSecret || undefined,
      appToken: f.baseAppToken || undefined,
      baseUrl: f.openBaseUrl
    });
    const sync = new LedgerSync(repos, mirror);
    const summary = await sync.run(body.data);
    await repos.audit({
      actorType: 'user',
      action: 'feishu_ledger_sync',
      entityType: 'feishu_base',
      entityId: f.baseAppToken || undefined,
      metadata: { mode: summary.mode, counts: summary.counts, errorCount: summary.errors.length }
    });
    return { ok: true, summary };
  });

  app.get<{ Params: { id: string } }>('/api/web/artifacts/:id', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const artifact = await repos.getArtifact(request.params.id);
    if (!artifact) {
      reply.code(404);
      return { ok: false, error: 'artifact_not_found' };
    }
    return {
      ok: true,
      artifact,
      preview: previewForArtifact(artifact)
    };
  });

  app.post<{ Body: unknown }>('/api/web/command', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const body = validateWebInput(commandSchema, request.body, reply);
    if (!body.ok) return body.response;
    const result = await submitWebCommand(brain, repos, config, body.data.text);
    return result;
  });

  app.post<{ Body: unknown }>('/api/web/mini-app/submit', { preHandler: allowWebConsoleAccess }, async (request, reply) => {
    const body = validateWebInput(miniAppSubmitSchema, request.body, reply);
    if (!body.ok) return body.response;
    const result = await submitWebCommand(brain, repos, config, body.data.text);
    const telegramNotified = await notifyTelegramMiniAppSubmission(request, result, body.data.kind, config);
    return {
      ok: true,
      source: 'telegram_mini_app',
      telegramNotified,
      ...result
    };
  });

  app.get('/', async (_request, reply) => serveWebApp('', reply));
  app.get('/app', async (_request, reply) => serveWebApp('', reply));
  app.get('/app/', async (_request, reply) => serveWebApp('', reply));
  app.get('/app/*', async (request, reply) => {
    const params = request.params as { '*': string };
    return serveWebApp(params['*'] ?? '', reply);
  });
}

async function submitWebCommand(
  brain: ChiefOfStaff,
  repos: Repositories,
  config: AppConfig,
  text: string
): Promise<WebCommandResult> {
  const ownerTelegramId = config.telegram.ownerIds[0] ?? 0;
  const webUser: TelegramUser = {
    id: ownerTelegramId,
    first_name: 'Web Owner',
    username: 'web_console'
  };
  const webChat: TelegramChat = {
    id: ownerTelegramId ? -Math.abs(ownerTelegramId) : -1,
    type: 'private',
    title: 'Tele-OPC Web Console'
  };
  const user = await repos.upsertUserFromTelegram(webUser);
  const chat = await repos.upsertChatFromTelegram(webChat);
  const message: TelegramMessage = {
    message_id: Math.floor(Date.now() % 2147483647),
    from: webUser,
    chat: webChat,
    date: Math.floor(Date.now() / 1000),
    text
  };
  const inbound = await repos.createInboundMessage({ message, userId: user.id, chatId: chat.id });
  const reply = await brain.handleText(text, {
    telegramUserId: webUser.id,
    userId: user.id,
    chatId: chat.id,
    originMessageId: inbound.id
  });
  await repos.createOutboundMessage({
    chatId: chat.id,
    text: reply,
    raw: {
      source: 'web_console',
      commandMessageId: inbound.id
    }
  });

  const snapshot = await taskSnapshotFromReply(repos, reply);

  return {
    reply,
    messageId: inbound.id,
    ...snapshot
  };
}

async function taskSnapshotFromReply(repos: Repositories, reply: string) {
  const taskId = extractTaskId(reply);
  if (!taskId) return {};

  return await taskSnapshotForTaskId(repos, taskId) ?? {};
}

async function taskSnapshotForTaskId(repos: Repositories, taskId: string) {
  const task = await repos.getTask(taskId);
  if (!task) return null;

  const parent = task.parent_task_id ? await repos.getTask(task.parent_task_id) : null;
  const displayTask = parent ?? task;
  const subtasks = await repos.listSubtasks(displayTask.id);
  const currentTask = task.parent_task_id
    ? task
    : firstOpenSubtask(subtasks) ?? task;
  const artifacts = await repos.listArtifactsForTaskIds([
    displayTask.id,
    ...subtasks.map((subtask) => subtask.id)
  ]);

  return {
    task: displayTask,
    currentTask,
    subtasks,
    artifacts
  };
}

function extractTaskId(text: string) {
  return text.match(/tsk_[a-z0-9-]+/i)?.[0] ?? null;
}

function firstOpenSubtask(subtasks: TaskRecord[]) {
  return subtasks
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.created_at.localeCompare(b.created_at))
    .find((task) => !['done', 'cancelled'].includes(task.status));
}

function previewForArtifact(artifact: ArtifactRecord) {
  const content = artifact.content ?? '';
  const isHtml = ['html_page', 'slide_deck_html'].includes(artifact.type) || /^\s*<!doctype html|<html[\s>]/i.test(content);
  return {
    mode: isHtml ? 'html' : 'text',
    title: artifact.title,
    content,
    metadata: artifact.metadata
  };
}


async function notifyTelegramMiniAppSubmission(
  request: FastifyRequest,
  result: Awaited<ReturnType<typeof submitWebCommand>>,
  kind: string,
  config: AppConfig
) {
  const initData = getTelegramInitDataValidation(request, config);
  if (!initData.valid || typeof initData.userId !== 'number') return false;

  const telegramClient = new TelegramClient(config.telegram.botToken);
  const extraLines = [
    `来源：Telegram Mini App / ${kind}`,
    'Mini App 已提交，后续请以这张任务卡为准。'
  ];

  const card = result.task
    ? buildTaskDetailCard(result.task, result.subtasks ?? [], config, extraLines)
    : {
        text: ['Mini App 已提交', '', truncateForTelegram(result.reply, 1200)].join('\n')
      };
  const sendResult = await telegramClient.sendMessage(initData.userId, card.text, { replyMarkup: card.replyMarkup });
  return Boolean(sendResult && typeof sendResult === 'object' && 'ok' in sendResult && sendResult.ok);
}

function truncateForTelegram(value: string, maxLength: number) {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

async function readCodexInbox(inboxPath: string) {
  const resolvedPath = path.resolve(process.cwd(), inboxPath);
  try {
    const content = await fs.readFile(resolvedPath, 'utf8');
    return content
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-10)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return { raw: line };
        }
      })
      .reverse();
  } catch {
    return [];
  }
}

async function serveWebApp(assetPath: string, reply: FastifyReply) {
  const webDist = path.resolve(process.cwd(), 'web', 'dist');
  const normalizedPath = normalizeAssetPath(assetPath);
  const resolvedAsset = path.resolve(webDist, normalizedPath);
  const indexPath = path.resolve(webDist, 'index.html');
  const requestedPath = resolvedAsset.startsWith(webDist) ? resolvedAsset : indexPath;
  const shouldServeAsset = normalizedPath && path.extname(normalizedPath);

  try {
    const filePath = shouldServeAsset ? requestedPath : indexPath;
    const data = await fs.readFile(filePath);
    reply.header('Cache-Control', shouldServeAsset ? 'public, max-age=31536000, immutable' : 'no-store');
    reply.type(contentTypeFor(filePath));
    return reply.send(data);
  } catch {
    try {
      const data = await fs.readFile(indexPath);
      reply.header('Cache-Control', 'no-store');
      reply.type('text/html; charset=utf-8');
      return reply.send(data);
    } catch {
      reply.code(503);
      reply.type('text/html; charset=utf-8');
      return reply.send(buildMissingWebAppHtml());
    }
  }
}

function normalizeAssetPath(assetPath: string) {
  return assetPath.replace(/\\/g, '/').replace(/^\/+/, '').split('?')[0] ?? '';
}

function contentTypeFor(filePath: string) {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function buildMissingWebAppHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tele-OPC Web Console</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #f6f7f2; display: grid; min-height: 100vh; place-items: center; }
      main { max-width: 560px; padding: 32px; border: 1px solid #333; border-radius: 8px; background: #181818; }
      code { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <main>
      <h1>Tele-OPC Web Console 尚未构建</h1>
      <p>请先运行 <code>npm run web:build</code> 或 <code>npm run build</code>，然后重新打开 <code>/app</code>。</p>
    </main>
  </body>
</html>`;
}

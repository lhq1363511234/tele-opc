import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentRunner } from './ai/agentRunner.js';
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
  const agentRunner = modelProvider ? new AgentRunner(modelProvider, repos) : null;
  const brain = new ChiefOfStaff(
    repos,
    new BullMqTaskDispatcher(config.redis.url),
    undefined,
    undefined,
    undefined,
    undefined,
    agentRunner
  );

  const allowWebConsoleAccess = async () => {};

  app.get('/api/web/session', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    app: {
      name: config.app.name,
      env: config.app.env,
      timezone: config.app.timezone
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
      return { ok: true, ...result };
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

  app.get('/api/web/mail', { preHandler: allowWebConsoleAccess }, async () => ({
    ok: true,
    dashboard: await repos.getMailDashboard()
  }));

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
        auth: 'disabled'
      },
      publicBaseUrl: config.app.publicBaseUrl
    }
  }));

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
    return { ok: true, ...result };
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

function getTelegramInitDataValidation(request: FastifyRequest, config: AppConfig) {
  const initData = tokenFromHeader(request.headers['x-telegram-init-data']);
  if (!initData) {
    return { present: false, valid: false, reason: 'missing_init_data' };
  }
  if (!config.telegram.botToken || config.telegram.botToken === 'change-me') {
    return { present: true, valid: false, reason: 'bot_token_missing' };
  }
  if (!config.telegram.ownerIds.length) {
    return { present: true, valid: false, reason: 'owner_ids_missing' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { present: true, valid: false, reason: 'hash_missing' };
  }
  params.delete('hash');

  const authDate = Number(params.get('auth_date') ?? 0);
  const ageSeconds = authDate ? Math.floor(Date.now() / 1000 - authDate) : null;
  if (!authDate) {
    return { present: true, valid: false, reason: 'auth_date_missing' };
  }
  if (ageSeconds !== null && ageSeconds > 24 * 60 * 60) {
    return { present: true, valid: false, reason: 'auth_date_expired', authDate, ageSeconds };
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeTokenEqual(hash, expected)) {
    return { present: true, valid: false, reason: 'hash_mismatch', authDate, ageSeconds };
  }

  const userParam = params.get('user');
  if (!userParam) {
    return { present: true, valid: false, reason: 'user_missing', authDate, ageSeconds };
  }

  try {
    const user = JSON.parse(userParam) as { id?: unknown };
    const userId = typeof user.id === 'number' ? user.id : undefined;
    const ownerAllowed = typeof userId === 'number' && config.telegram.ownerIds.includes(userId);
    return {
      present: true,
      valid: ownerAllowed,
      reason: ownerAllowed ? 'ok' : 'owner_not_allowed',
      userId,
      ownerAllowed,
      authDate,
      ageSeconds,
      queryId: params.get('query_id') ?? undefined,
      startParam: params.get('start_param') ?? undefined
    };
  } catch {
    return { present: true, valid: false, reason: 'user_parse_failed', authDate, ageSeconds };
  }
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

function tokenFromHeader(value: string | string[] | undefined) {
  const token = Array.isArray(value) ? value[0] : value;
  return token?.trim() || null;
}

function safeTokenEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
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

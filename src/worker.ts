import { Worker } from 'bullmq';
import { getAgentDefinition } from './agents/registry.js';
import { LocalBrowserRunner } from './browser/browserRunner.js';
import { loadConfig } from './config/index.js';
import { pool } from './db/pool.js';
import { Repositories } from './db/repositories.js';
import { CampaignEmailSender } from './email/campaignEmailSender.js';
import { deckInputFromPublicBrief, slideDeckSpecFromAgentContent } from './deliverables/slideDeckSpec.js';
import { AgentRunner } from './ai/agentRunner.js';
import { systemPromptForAgent } from './ai/agentPrompts.js';
import { buildCapabilityTools } from './ai/capabilityTools.js';
import { buildExternalActionTools, runApprovedAction } from './ai/externalActionTools.js';
import { createModelProviderFromConfig } from './ai/modelProvider.js';
import { logger } from './logger.js';
import { BullMqTaskDispatcher, parseRedisConnection, taskQueueName, type TaskJobData } from './queue/taskQueue.js';
import { TelegramClient } from './telegram/client.js';
import { buildTaskDetailCard } from './telegram/ux.js';
import type { TaskRecord } from './types.js';
import { workStrategyFromMetadata, type TaskPublicBrief, type WorkStrategy } from './work/workStrategy.js';
import { buildFeishuMirror } from './appos/feishu/ledger-mirror.js';
import { LedgerSync } from './appos/feishu/ledger-sync.js';
import { PaperclipBridge } from './integrations/paperclip/bridge.js';
import { runLeadCampaign, type CampaignLead } from './prospecting/leadCampaign.js';
import { runMarketScan, type MarketOpportunity } from './prospecting/marketScan.js';

const config = loadConfig();
const repos = new Repositories(pool);
const browserRunner = new LocalBrowserRunner(repos);
const campaignEmailSender = new CampaignEmailSender(repos);
const taskDispatcher = new BullMqTaskDispatcher(config.redis.url);
const paperclipBridge = new PaperclipBridge(config, repos, taskDispatcher);
const telegramClient = new TelegramClient(config.telegram.botToken);
const modelProvider = createModelProviderFromConfig(config);
const contentAgentRunner = modelProvider ? new AgentRunner(modelProvider, repos) : null;
const feishuMirror = buildFeishuMirror({
  publicBaseUrl: config.app.publicBaseUrl,
  appId: config.feishu.appId || undefined,
  appSecret: config.feishu.appSecret || undefined,
  appToken: config.feishu.baseAppToken || undefined,
  baseUrl: config.feishu.openBaseUrl
});
const ledgerSync = new LedgerSync(repos, feishuMirror);
const externalActionOptions = config.feishu.appId && config.feishu.appSecret && config.feishu.baseAppToken
  ? {
      feishu: {
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        appToken: config.feishu.baseAppToken,
        baseUrl: config.feishu.openBaseUrl
      }
    }
  : {};
let ledgerSyncRunning = false;
let ledgerSyncTimer: NodeJS.Timeout | null = null;

async function runAutomaticLedgerSync(trigger: 'startup' | 'interval' | 'task_completed') {
  if (!config.feishu.mirrorEnabled || feishuMirror.mode !== 'openapi' || ledgerSyncRunning) return;
  ledgerSyncRunning = true;
  const startedAt = Date.now();
  try {
    const summary = await ledgerSync.run({ taskLimit: 100, approvalLimit: 100, leadLimit: 100, artifactLimit: 100, analyticsLimit: 20 });
    const totals = Object.values(summary.counts).reduce(
      (acc, count) => ({
        attempted: acc.attempted + count.attempted,
        created: acc.created + count.created,
        updated: acc.updated + count.updated,
        failed: acc.failed + count.failed
      }),
      { attempted: 0, created: 0, updated: 0, failed: 0 }
    );
    logger.info({ trigger, durationMs: Date.now() - startedAt, totals }, 'Feishu ledger auto sync completed');
  } catch (error) {
    logger.warn({ trigger, error: error instanceof Error ? error.message : String(error) }, 'Feishu ledger auto sync failed');
  } finally {
    ledgerSyncRunning = false;
  }
}

function startAutomaticLedgerSync() {
  if (!config.feishu.mirrorEnabled || feishuMirror.mode !== 'openapi') {
    logger.info({ enabled: config.feishu.mirrorEnabled, mode: feishuMirror.mode }, 'Feishu ledger auto sync disabled');
    return;
  }
  const intervalMs = config.feishu.autoSyncIntervalMs;
  const startupTimer = setTimeout(() => void runAutomaticLedgerSync('startup'), 5000);
  startupTimer.unref();
  ledgerSyncTimer = setInterval(() => void runAutomaticLedgerSync('interval'), intervalMs);
  ledgerSyncTimer.unref();
  logger.info({ intervalMs }, 'Feishu ledger auto sync enabled');
}


const worker = new Worker<TaskJobData>(
  taskQueueName,
  async (job) => {
    const { taskId } = job.data;
    logger.info({ jobId: job.id, name: job.name, data: job.data }, 'worker received job');

    const task = await repos.getTask(taskId);
    if (!task) {
      await repos.audit({
        actorType: 'system',
        action: 'worker_task_missing',
        entityType: 'task',
        entityId: taskId,
        metadata: { jobId: job.id, data: job.data }
      });
      return { ok: false, reason: 'task_not_found', taskId };
    }

    try {
      await repos.updateTaskStatus(taskId, 'running', `Worker started job ${job.id}`);
      if (task.parent_task_id) {
        await repos.updateTaskStatus(task.parent_task_id, 'running', `Subtask ${task.id} started`);
      }
      await repos.audit({
        actorType: 'system',
        action: 'worker_task_started',
        entityType: 'task',
        entityId: taskId,
        metadata: { jobId: job.id, data: job.data }
      });
      await notifyTaskLifecycle(taskId, [`开始执行：${task.title}`]);

      const result = job.data.source === 'approval'
        ? await approvedActionResultFor(task, job.data)
        : task.owner_agent === 'browser'
        ? await browserResultFor(job.data.taskId)
        : task.planning_metadata.workflow === 'campaign_send'
          ? await campaignSendResultFor(task.planning_metadata)
          : task.planning_metadata.workflow === 'lead_campaign'
            ? await leadCampaignResultFor(task)
          : task.planning_metadata.workflow === 'market_scan'
            ? await marketScanResultFor(task)
          : task.planning_metadata.workflow === 'content'
              ? await contentStepResultFor(task)
          : await operatingStepResultFor(task, job.data);
      await repos.completeTask(taskId, result);
      await paperclipBridge.syncTaskResult(task, 'done', result).catch((error) => {
        logger.warn({ taskId, error: error instanceof Error ? error.message : String(error) }, 'Paperclip completion callback failed');
      });
      await repos.audit({
        actorType: 'system',
        action: 'worker_task_completed',
        entityType: 'task',
        entityId: taskId,
        metadata: { jobId: job.id, result }
      });
      await notifyTaskLifecycle(taskId, [`完成步骤：${task.title}`, summarizeResult(result)]);
      await continueParentWorkflow(task);

      return { ok: true, taskId, status: 'done' };
    } catch (error) {
      await repos.updateTaskStatus(taskId, 'failed', 'Worker failed while processing task');
      await paperclipBridge.syncTaskResult(task, 'failed', error instanceof Error ? error.message : 'unknown error').catch((callbackError) => {
        logger.warn({ taskId, error: callbackError instanceof Error ? callbackError.message : String(callbackError) }, 'Paperclip failure callback failed');
      });
      await notifyTaskLifecycle(taskId, [
        `执行失败：${task.title}`,
        error instanceof Error ? error.message : 'unknown error'
      ]);
      await repos.audit({
        actorType: 'system',
        action: 'worker_task_failed',
        entityType: 'task',
        entityId: taskId,
        metadata: {
          jobId: job.id,
          error: error instanceof Error ? error.message : 'unknown error'
        }
      });
      throw error;
    }
  },
  {
    connection: parseRedisConnection(config.redis.url),
    // Lead campaigns run for several minutes; keep the job lock alive.
    lockDuration: 10 * 60 * 1000,
    stalledInterval: 60 * 1000
  }
);

worker.on('ready', () => {
  logger.info({ env: config.app.env }, 'Tele-OPC OS worker ready');
  startAutomaticLedgerSync();
});

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'worker job completed');
  void runAutomaticLedgerSync('task_completed');
});

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error }, 'worker job failed');
});

async function shutdown() {
  logger.info('Tele-OPC OS worker shutting down');
  if (ledgerSyncTimer) clearInterval(ledgerSyncTimer);
  await worker.close();
  await pool.end();
}

process.on('SIGINT', () => {
  shutdown().catch((error) => {
    logger.error({ error }, 'worker shutdown failed');
    process.exitCode = 1;
  });
});

process.on('SIGTERM', () => {
  shutdown().catch((error) => {
    logger.error({ error }, 'worker shutdown failed');
    process.exitCode = 1;
  });
});

/**
 * Scans the live market for where money is moving and ranks the fastest paths
 * to cash. Answers "哪个赛道现在挣钱快", which lead campaigns cannot.
 */
/**
 * Runs an external action that the owner just approved. Before this, approved
 * approvals only produced a placeholder string, so emails and Feishu writes
 * were never actually performed.
 */
async function approvedActionResultFor(task: TaskRecord, data: TaskJobData) {
  if (!data.approvalId) {
    return foundationResultFor(data, task.owner_agent, task.planning_metadata);
  }
  const approval = await repos.getApproval(data.approvalId);
  if (!approval) return `找不到审批 ${data.approvalId}，没有执行任何动作。`;

  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : approval.action_type;
  const outcome = await runApprovedAction(toolName, payload, externalActionOptions);

  await repos.audit({
    actorType: 'system',
    action: outcome.ok ? 'external_action_executed' : 'external_action_failed',
    entityType: 'approval',
    entityId: approval.id,
    metadata: { toolName, taskId: task.id, outcome }
  });

  if (!outcome.ok) {
    return [
      `外部动作执行失败：${toolName}`,
      `审批：${approval.id}`,
      `原因：${String(outcome.error ?? 'unknown')}`
    ].join('\n');
  }

  if (toolName === 'send_email') {
    return [
      '邮件已真实发出。',
      `收件人：${Array.isArray(outcome.to) ? outcome.to.join(', ') : String(outcome.to ?? '')}`,
      `主题：${String(outcome.subject ?? '')}`,
      outcome.messageId ? `Message-ID：${String(outcome.messageId)}` : ''
    ].filter(Boolean).join('\n');
  }

  if (toolName === 'write_feishu_table') {
    return [
      '已写入飞书多维表格。',
      `表：${String(outcome.table ?? '')}`,
      `写入行数：${String(outcome.written ?? 0)}`
    ].join('\n');
  }

  return `外部动作已执行：${toolName}`;
}

async function marketScanResultFor(task: TaskRecord) {
  const metadata = task.planning_metadata as Record<string, unknown>;
  const goal = typeof metadata.goal === 'string' ? metadata.goal : task.description ?? task.title;
  const assets = typeof metadata.assets === 'string' ? metadata.assets : '';

  let lastNotifiedPhase = '';
  const scan = await runMarketScan({
    config,
    goal,
    assets,
    voiceBlock: await personaVoiceBlock(),
    onProgress: async (progress) => {
      if (progress.phase === lastNotifiedPhase) return;
      lastNotifiedPhase = progress.phase;
      await repos.updateTaskStatus(task.id, 'running', progress.message).catch(() => undefined);
      await notifyTaskLifecycle(task.id, [progress.message]).catch(() => undefined);
    }
  });

  if (!scan.opportunities.length) {
    return [
      '市场扫描没有产出可信结论。',
      `检索式：${scan.queries.join(' / ') || '无'}`,
      `读取来源：${scan.sourcesRead}`,
      scan.marketRead
    ].filter(Boolean).join('\n');
  }

  const artifact = await repos.createArtifact({
    taskId: task.id,
    type: 'market_scan_report',
    title: `市场扫描报告：${goal.slice(0, 40)}`,
    uri: `tele-opc://artifacts/market_scan/${task.id}`,
    content: renderMarketScanReport(scan.marketRead, scan.opportunities, goal),
    metadata: {
      source: 'market_scan',
      goal,
      assets,
      queries: scan.queries,
      sourcesRead: scan.sourcesRead,
      opportunityCount: scan.opportunities.length
    }
  });

  const top = scan.opportunities[0];
  return [
    `市场扫描完成：读了 ${scan.sourcesRead} 个公开来源 / ${scan.queries.length} 条检索式`,
    '',
    scan.marketRead ? `钱现在往哪流：${scan.marketRead}` : '',
    '',
    '排出来的方向：',
    ...scan.opportunities.map((item, index) =>
      `${index + 1}. ${item.name}（${item.totalScore} 分 · ${item.daysToFirstCash} 天见钱 · ${item.pricePoint}）\n   买家：${item.buyer}`
    ),
    '',
    `我的判断：先打「${top.name}」。`,
    `理由：${top.demandEvidence}`,
    `今天就做这一件事：${top.firstMove}`,
    `风险：${top.risk}`,
    '',
    `完整报告：${artifact.id}`
  ].filter(Boolean).join('\n');
}

function renderMarketScanReport(marketRead: string, opportunities: MarketOpportunity[], goal: string) {
  return [
    '# 市场扫描报告',
    '',
    `**目标**：${goal}`,
    marketRead ? `**钱现在往哪流**：${marketRead}` : '',
    '',
    ...opportunities.flatMap((item, index) => [
      `## ${index + 1}. ${item.name}　${item.totalScore} 分`,
      `- 赛道：${item.market}`,
      `- 谁付钱：${item.buyer}`,
      `- 卖什么：${item.offer}`,
      `- 价位：${item.pricePoint}`,
      `- 多久见第一笔钱：${item.daysToFirstCash} 天`,
      `- 分项：见钱快 ${item.speedScore} / 契合度 ${item.fitScore} / 证据强度 ${item.evidenceScore}`,
      item.demandEvidence ? `- 需求证据：${item.demandEvidence}` : '',
      item.competition ? `- 竞争情况：${item.competition}` : '',
      item.firstMove ? `- **今天的第一步**：${item.firstMove}` : '',
      item.risk ? `- 风险：${item.risk}` : '',
      item.sources.length ? `- 来源：${item.sources.join(' / ')}` : '',
      ''
    ])
  ].filter((line) => line !== undefined).join('\n');
}

async function leadCampaignResultFor(task: TaskRecord) {
  const metadata = task.planning_metadata as Record<string, unknown>;
  const offer = typeof metadata.offer === 'string' ? metadata.offer : task.description ?? task.title;
  const icp = typeof metadata.icp === 'string' ? metadata.icp : offer;
  const region = typeof metadata.region === 'string' ? metadata.region : '';
  const target = Number(metadata.target) > 0 ? Math.min(200, Number(metadata.target)) : 20;

  let lastNotifiedPhase = '';
  const campaign = await runLeadCampaign({
    config,
    offer,
    icp,
    region,
    target,
    voiceBlock: await personaVoiceBlock(),
    onProgress: async (progress) => {
      if (progress.phase === lastNotifiedPhase) return;
      lastNotifiedPhase = progress.phase;
      await repos.updateTaskStatus(task.id, 'running', progress.message).catch(() => undefined);
      await notifyTaskLifecycle(task.id, [`[${progress.found}/${progress.target}] ${progress.message}`]).catch(() => undefined);
    }
  });

  if (!campaign.leads.length) {
    return [
      `客户挖掘没有产出结果。`,
      `检索式：${campaign.queries.join(' / ') || '无'}`,
      `读取来源：${campaign.sourcesRead}`,
      '公开搜索这次没命中，可以把目标客户描述写得更具体后重试。'
    ].join('\n');
  }

  const created: string[] = [];
  const failed: string[] = [];
  for (const lead of campaign.leads) {
    try {
      const result = await repos.createCrmLead({
        name: lead.name?.trim() || `${lead.organizationName} 负责人`,
        organizationName: lead.organizationName,
        interest: lead.businessLine || offer,
        note: [
          lead.note,
          lead.buyingSignal ? `信号：${lead.buyingSignal}` : '',
          lead.scoreReason ? `评分依据（${lead.score}）：${lead.scoreReason}` : '',
          lead.outreach ? `触达话术：${lead.outreach}` : '',
          lead.sourceUrl ? `来源：${lead.sourceUrl}` : ''
        ].filter(Boolean).join('\n') || offer
      });
      created.push(result.contact.id);
    } catch (error) {
      failed.push(`${lead.organizationName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const artifact = await repos.createArtifact({
    taskId: task.id,
    type: 'lead_campaign_report',
    title: `客户挖掘报告：${offer.slice(0, 40)}`,
    uri: `tele-opc://artifacts/lead_campaign/${task.id}`,
    content: renderCampaignReport(campaign.leads, offer, campaign.icpSummary),
    metadata: {
      source: 'lead_campaign',
      offer,
      icp,
      region,
      target,
      queries: campaign.queries,
      sourcesRead: campaign.sourcesRead,
      leadCount: campaign.leads.length,
      createdContactIds: created
    }
  });

  const hot = campaign.leads.filter((lead) => Number(lead.score ?? 0) >= 70).length;
  return [
    `客户挖掘完成：${campaign.leads.length} 家（目标 ${target} 家）`,
    `高匹配（70分以上）：${hot} 家`,
    `读取公开来源：${campaign.sourcesRead} 个 / 检索式 ${campaign.queries.length} 条`,
    `已写入 CRM：${created.length} 条${failed.length ? `，失败 ${failed.length} 条` : ''}`,
    `报告：${artifact.id}`,
    '',
    '匹配度最高的几家：',
    ...campaign.leads.slice(0, 5).map((lead, index) =>
      `${index + 1}. ${lead.organizationName}（${lead.score}）${lead.approach ? ` — ${lead.approach}` : ''}`
    ),
    '',
    '每家的触达话术已写进 CRM 备注，到 CRM 页面可以直接用。'
  ].join('\n');
}

function renderCampaignReport(leads: CampaignLead[], offer: string, icpSummary: string) {
  return [
    `# 客户挖掘报告`,
    '',
    `**在卖什么**：${offer}`,
    icpSummary ? `**客户画像**：${icpSummary}` : '',
    `**产出**：${leads.length} 家`,
    '',
    ...leads.flatMap((lead, index) => [
      `## ${index + 1}. ${lead.organizationName}　${lead.score} 分`,
      lead.businessLine ? `- 业务：${lead.businessLine}` : '',
      lead.region ? `- 地区：${lead.region}` : '',
      lead.buyingSignal ? `- 信号：${lead.buyingSignal}` : '',
      lead.scoreReason ? `- 评分依据：${lead.scoreReason}` : '',
      lead.approach ? `- 切入点：${lead.approach}` : '',
      lead.outreach ? `- 触达话术：${lead.outreach}` : '',
      lead.sourceUrl ? `- 来源：${lead.sourceUrl}` : '',
      ''
    ])
  ].filter((line) => line !== undefined).join('\n');
}

async function personaVoiceBlock() {
  const profile = await repos.getASelfProfile().catch(() => null);
  if (!profile) return '（人格未蒸馏，用克制专业、不过度承诺的语气）';
  const toList = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  return [
    `你在替 ${profile.display_name} 输出内容，必须像本人写的。`,
    `沟通风格：${JSON.stringify(profile.communication_style ?? {})}`,
    `绝不做：${toList(profile.boundaries).join(' | ') || '未设定'}`,
    `价值排序：${toList(profile.values_order).join(' | ') || '未设定'}`
  ].join('\n');
}

/**
 * Executes a normal operating subtask with the real model and real CRM data.
 * Previously every non-content, non-campaign step fell through to
 * foundationResultFor(), which returned a placeholder string and marked the
 * task done without doing any work.
 */
async function operatingStepResultFor(task: TaskRecord, data: TaskJobData) {
  if (!contentAgentRunner) {
    return foundationResultFor(data, task.owner_agent, task.planning_metadata);
  }

  const agent = getAgentDefinition(task.owner_agent);
  const parent = task.parent_task_id ? await repos.getTask(task.parent_task_id) : null;
  const siblings = parent ? await repos.listSubtasks(parent.id) : [];
  const doneSiblings = siblings
    .filter((item) => item.id !== task.id && item.result)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .slice(-4);

  const persona = await personaVoiceBlock();

  const result = await contentAgentRunner.run({
    agentId: task.owner_agent,
    systemPrompt: systemPromptForAgent(task.owner_agent),
    taskId: task.id,
    userText: [
      persona,
      '',
      `你是 ${agent.displayName}，现在要真正执行下面这一步，不是描述你会怎么做。`,
      '',
      parent ? `总目标：${parent.description ?? parent.title}` : '',
      `本步任务：${task.title}`,
      task.description ? `任务说明：${task.description}` : '',
      '',
      doneSiblings.length
        ? ['前面几步已完成的结果：', ...doneSiblings.map((item) => `- ${item.title}：${(item.result ?? '').slice(0, 500)}`)].join('\n')
        : '',
      '',
      '你有这些工具，遇到不知道的事就去查，不要靠猜：',
      '- search_web / read_url：查公开信息、行情、报价、公司资料',
      '- search_crm：查我们自己数据库里已有的线索',
      '- save_lead：把真实找到的新线索写进 CRM',
      '- save_deliverable：把长报告或要复用的产出存成交付物',
      '- send_email / write_feishu_table：真实对外动作，会先拦下来等老板批准，所以要写最终版本，不要写占位内容',
      '',
      '硬性要求：',
      '- 需要外部事实（价格、市场、某家公司情况）时必须先用工具查，查到什么说什么',
      '- 直接给结论和产出，不要写"我将会…"这类计划体',
      '- 引用具体的公司名、数字、渠道，不允许泛泛而谈',
      '- 缺少必要信息就明确说缺什么、下一步怎么补，不要编造',
      '- 必须由本人亲自做的动作（付款、签字、实名收款）单独标出「需要你本人操作」',
      '- 最后给人看的回复控制在 300 字以内，中文，不要客套'
    ].filter(Boolean).join('\n'),
    context: {
      ownerAgent: task.owner_agent,
      parentTaskId: parent?.id ?? null
    },
    tools: [
      ...buildCapabilityTools(repos, { taskId: task.id }),
      ...buildExternalActionTools(repos, { ...externalActionOptions, taskId: task.id })
    ],
    maxToolRounds: 6,
    metadata: {
      workflow: 'operating_step',
      source: 'worker_operating_executor',
      parentTaskId: parent?.id ?? null
    }
  });

  const text = result.content.trim();
  if (!text) return foundationResultFor(data, task.owner_agent, task.planning_metadata);

  const usedTools = result.toolCalls.filter((call) => call.status !== 'failed');
  const toolTrace = usedTools.length
    ? `\n\n（调用了 ${usedTools.length} 次工具：${[...new Set(usedTools.map((call) => call.name))].join('、')}）`
    : '';
  return [`${agent.displayName}：`, '', text].join('\n') + toolTrace;
}

function foundationResultFor(data: TaskJobData, ownerAgent: string, metadata: Record<string, unknown>) {
  const agent = getAgentDefinition(ownerAgent);
  if (data.source === 'approval') {
    return `V3 Agent OS worker recorded approved action ${data.actionType ?? 'finance_action'} for ${agent.displayName}.`;
  }
  if (metadata.v3 === true) {
    const workflow = typeof metadata.workflow === 'string' ? metadata.workflow : 'v3_workflow';
    const skillIds = skillIdsFromMetadata(metadata);
    return [
      `V3 Agent OS executed ${workflow} registration for ${agent.displayName}.`,
      skillIds.length ? `Skill trace: ${skillIds.join(', ')}` : 'Skill trace: pending.',
      'Current phase completed task registration, subtask planning, audit logging, and queue execution.',
      'External connectors remain gated behind later roadmap phases.'
    ].join('\n');
  }
  return `V3 Agent OS routed this task to ${agent.displayName}. The current local worker completed the registration, audit, and task-state loop.`;
}

function skillIdsFromMetadata(metadata: Record<string, unknown>) {
  const drafts = [metadata.solutionDraft, metadata.prospectingDraft];
  for (const draft of drafts) {
    if (isRecord(draft) && Array.isArray(draft.selectedSkillIds)) {
      return draft.selectedSkillIds.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
}

async function contentStepResultFor(task: TaskRecord) {
  const parent = task.parent_task_id ? await repos.getTask(task.parent_task_id) : null;
  const strategy = workStrategyFromMetadata(parent?.planning_metadata ?? task.planning_metadata);
  if (!strategy) return foundationResultFor({ taskId: task.id, source: 'intake' }, task.owner_agent, task.planning_metadata);

  const sequence = task.sequence ?? 1;
  const totalSteps = strategy.steps.length || 1;
  const plannedStep = strategy.steps[sequence - 1];
  const agent = getAgentDefinition(task.owner_agent);
  const topic = parent?.description ?? task.description ?? parent?.title ?? task.title;

  if (sequence < totalSteps) {
    return [
      `工作策略步骤 ${sequence}/${totalSteps}`,
      `执行 Agent：${agent.displayName} (${agent.id})`,
      `任务：${task.title}`,
      plannedStep ? `预期产出：${plannedStep.expectedOutput}` : '',
      '',
      contentIntermediateOutput(strategy, sequence, topic),
      '',
      `下一步：${strategy.steps[sequence]?.title ?? '生成最终交付物'}`
    ].filter(Boolean).join('\n');
  }

  const siblings = parent ? await repos.listSubtasks(parent.id) : [];
  const ordered = siblings
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.created_at.localeCompare(b.created_at));
  const publicBrief = publicBriefForContentTask(task, parent, topic, strategy);
  const artifactContent = await renderContentArtifact(strategy, publicBrief, ordered, task, parent);
  const artifact = strategy.delivery.telegramMode === 'summary_with_preview'
    ? await repos.createArtifact({
        taskId: parent?.id ?? task.id,
        type: strategy.delivery.artifactType,
        title: `${strategy.delivery.title}：${shortTitle(topic)}`,
        uri: `tele-opc://artifacts/${strategy.delivery.artifactType}/${parent?.id ?? task.id}`,
        content: artifactContent,
        metadata: {
          workflow: 'content',
          workStrategy: strategy,
          deliveryStrategy: strategy.delivery,
          parentTaskId: parent?.id ?? null,
          sourceTaskId: task.id,
          agentChain: ordered.map((item) => ({
            sequence: item.sequence,
            taskId: item.id,
            ownerAgent: item.owner_agent,
            title: item.title
          }))
        }
      })
    : null;

  return [
    `工作策略完成：${strategy.rationale}`,
    `执行模式：${strategy.executionMode}`,
    `主 Agent：${strategy.leadAgent}`,
    `最终执行 Agent：${agent.displayName} (${agent.id})`,
    `交付方式：${strategy.delivery.title} / ${strategy.delivery.primarySurface}`,
    artifact ? `交付物：${artifact.id}` : '',
    artifact ? `预览路径：/deliverables/${artifact.id}` : '',
    '',
    'Agent 执行链：',
    ...ordered.map((item) => `${item.sequence ?? '-'} ${getAgentDefinition(item.owner_agent).displayName}：${item.title}`),
    '',
    artifact
      ? 'Telegram 应只显示摘要和“打开预览”按钮；完整内容在交付物里。'
      : contentIntermediateOutput(strategy, sequence, topic)
  ].filter(Boolean).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contentIntermediateOutput(strategy: WorkStrategy, sequence: number, topic: string) {
  if (strategy.delivery.kind === 'presentation_deck') {
    if (sequence === 1) {
      return [
        `领导原话分析：${shortTitle(topic)}`,
        '交付判断：这不是普通文案任务，而是需要展示的幻灯片成品。',
        '默认假设：中文、10-12 页、先交付 v0、适合 Telegram Mini App 预览。',
        '成功标准：每页一个结论，有执行链、有风险边界、有下一步。'
      ].join('\n');
    }
    if (sequence === 2) {
      return [
        '研究摘要框架：',
        '1. 明确汇报对象最关心的收益、风险、成本和落地周期。',
        '2. 收集已有资料、公司记忆、公开事实和不可验证的假设。',
        '3. 缺少来源的数据只作为“待验证假设”，不写成确定结论。'
      ].join('\n');
    }
    if (sequence === 3) {
      return [
        '叙事结构：',
        '封面 -> 结论先行 -> 背景变化 -> 核心问题 -> 关键洞察 -> 方案路径 -> 执行计划 -> 风险边界 -> 下一步。',
        '每页只承担一个目的，避免把长文章拆成伪 PPT。'
      ].join('\n');
    }
    if (sequence === 4) {
      return [
        '逐页内容原则：',
        '每页包含标题、单句结论、3-5 个要点、图表/画面建议和讲稿提示。',
        '页面正文要短，复杂内容进入备注或附录。'
      ].join('\n');
    }
    if (sequence === 5) {
      return [
        '视觉版式建议：',
        '使用深色标题、低饱和背景、少量强调色；重点页用流程图、矩阵、时间线和状态卡表达。',
        '最终步骤会生成 slide deck HTML artifact，可在 Mini App 内预览。'
      ].join('\n');
    }
    return [
      '最终交付策略：',
      '把前面步骤合成为可预览幻灯片，不在 Telegram 中刷长文。',
      '交付物将包含封面、结论、工作方法、执行链、风险边界和下一步。'
    ].join('\n');
  }

  if (strategy.delivery.kind === 'html_page') {
    if (sequence === 1) {
      return [
        `网页 brief：${shortTitle(topic)}`,
        '目标：让手机端用户先看懂产品/项目是什么、价值是什么、下一步怎么行动。',
        '首屏：名称、定位、一句话价值、主 CTA。',
        '模块：痛点、能力、工作流、示例、信任边界、下一步。'
      ].join('\n');
    }
    return [
      '信息架构：',
      '1. 首屏说明对象和价值。',
      '2. 用流程图区分“接收任务、Agent 编排、产出交付”。',
      '3. 用卡片展示能力，但不做营销空话。',
      '4. 底部保留继续对话或打开控制台入口。'
    ].join('\n');
  }

  if (strategy.delivery.kind === 'code_or_markup') {
    return [
      `代码工作说明：${shortTitle(topic)}`,
      '先确定运行环境、文件边界和验收标准，再生成代码 artifact。',
      'Telegram 不直接刷完整代码，避免难复制、难审阅、难回滚。'
    ].join('\n');
  }

  if (strategy.delivery.kind === 'long_document') {
    return [
      `文档结构：${shortTitle(topic)}`,
      '摘要、背景、核心判断、执行步骤、风险和下一步。',
      '长正文进入阅读容器，Telegram 只发摘要和目录。'
    ].join('\n');
  }

  return [
    `内容 brief：${shortTitle(topic)}`,
    '目标、受众、语气、核心信息、CTA 和风险边界已整理。',
    '下一步生成草稿并检查是否涉及公开发布或外部动作。'
  ].join('\n');
}

async function renderContentArtifact(
  strategy: WorkStrategy,
  publicBrief: TaskPublicBrief,
  orderedTasks: TaskRecord[],
  task: TaskRecord,
  parent: TaskRecord | null
) {
  if (strategy.delivery.kind === 'presentation_deck') {
    return await renderPresentationDeckArtifact(publicBrief, orderedTasks, task, parent);
  }

  if (strategy.delivery.kind === 'html_page') {
    const title = shortTitle(publicBrief.title);
    const sections = publicBrief.mustInclude.length > 0
      ? publicBrief.mustInclude
      : ['核心价值', '适用场景', '执行路径', '风险边界', '下一步行动'];
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8f4; color: #17211d; }
      body { margin: 0; }
      main { max-width: 920px; margin: 0 auto; padding: 28px 18px 40px; }
      section { padding: 20px 0; border-bottom: 1px solid #dde5dd; }
      h1 { margin: 0 0 12px; font-size: clamp(30px, 8vw, 64px); line-height: 1; letter-spacing: 0; }
      h2 { margin: 0 0 10px; font-size: 22px; letter-spacing: 0; }
      p { line-height: 1.7; margin: 0 0 12px; color: #40564e; }
      .hero { min-height: 72vh; display: grid; align-content: center; }
      .badge { display: inline-flex; width: fit-content; border-radius: 999px; background: #dff3ea; color: #176855; padding: 7px 11px; font-weight: 800; margin-bottom: 18px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
      .card { border: 1px solid #dde5dd; border-radius: 8px; background: #fff; padding: 14px; }
      .steps { counter-reset: step; display: grid; gap: 10px; }
      .steps li { list-style: none; border-left: 3px solid #177e72; padding: 8px 0 8px 12px; background: #fff; }
      .cta { display: inline-flex; border-radius: 8px; background: #17211d; color: #fff; padding: 12px 16px; text-decoration: none; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="badge">${escapeHtml(publicBrief.audience)} · ${escapeHtml(publicBrief.style)}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(publicBrief.purpose)}</p>
        <a class="cta" href="#next">查看下一步</a>
      </section>
      <section>
        <h2>页面重点</h2>
        <div class="grid">
          ${sections.map((item) => `<article class="card">${escapeHtml(item)}</article>`).join('\n          ')}
        </div>
      </section>
      <section id="next">
        <h2>建议行动</h2>
        <div class="grid">
          ${audienceNextSteps(publicBrief).map((item) => `<article class="card">${escapeHtml(item)}</article>`).join('\n          ')}
        </div>
      </section>
    </main>
  </body>
</html>`;
  }

  return [
    `# ${publicBrief.title}`,
    '',
    publicBrief.purpose,
    '',
    '## 面向对象',
    publicBrief.audience,
    '',
    '## 必须包含',
    ...(publicBrief.mustInclude.length > 0 ? publicBrief.mustInclude.map((item) => `- ${item}`) : ['- 核心结论', '- 关键依据', '- 执行步骤', '- 风险边界', '- 下一步行动'])
  ].join('\n');
}

async function renderPresentationDeckArtifact(
  brief: TaskPublicBrief,
  orderedTasks: TaskRecord[],
  task: TaskRecord,
  parent: TaskRecord | null
) {
  const executionStepCount = orderedTasks.length;
  if (!contentAgentRunner) {
    throw new Error('presentation_deck_requires_ai_model_provider');
  }
  const deckInput = deckInputFromPublicBrief(brief);
  const prompt = deliverableAgentPromptForContentTask(task, parent);
  const agentResult = await contentAgentRunner.run({
    agentId: 'content',
    systemPrompt: systemPromptForAgent('content'),
    userText: prompt,
    taskId: task.id,
    context: {
      output: 'slide_deck_spec_json',
      deckInput,
      publicBrief: brief
    },
    metadata: {
      workflow: 'presentation_deck_artifact',
      source: 'task_contract_deliverable_agent',
      parentTaskId: parent?.id ?? null
    },
    maxToolRounds: 0
  });
  const deck = slideDeckSpecFromAgentContent(agentResult.content, deckInput);
  const slides = deck.slides;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="tele-opc-delivery" content="presentation_deck" />
    <meta name="tele-opc-step-count" content="${executionStepCount}" />
    <title>${escapeHtml(deck.title)} - Slide Deck</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ink: #16201b;
        --muted: #637269;
        --line: #d9dfd8;
        --surface: #fbfcf8;
        --accent: #177e72;
        --warm: #f4c95d;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: #eef2ec; color: var(--ink); }
      .deck { min-height: 100vh; scroll-snap-type: y mandatory; overflow-y: auto; }
      .slide {
        min-height: 100vh;
        scroll-snap-align: start;
        display: grid;
        align-items: center;
        padding: clamp(22px, 5vw, 72px);
        border-bottom: 1px solid var(--line);
        background:
          linear-gradient(rgba(22, 32, 27, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(22, 32, 27, 0.04) 1px, transparent 1px),
          var(--surface);
        background-size: 36px 36px;
      }
      .frame {
        width: min(1120px, 100%);
        margin: 0 auto;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(240px, 0.58fr);
        gap: clamp(18px, 4vw, 56px);
        align-items: end;
      }
      .eyebrow {
        display: inline-flex;
        width: fit-content;
        margin-bottom: 18px;
        border-radius: 999px;
        background: #e3f4ef;
        color: #17695f;
        padding: 7px 11px;
        font-size: 13px;
        font-weight: 900;
      }
      h1, h2 { margin: 0; letter-spacing: 0; }
      h1 { font-size: clamp(42px, 8vw, 86px); line-height: 0.98; }
      h2 { font-size: clamp(34px, 6vw, 64px); line-height: 1.02; }
      p { margin: 18px 0 0; color: #354a41; font-size: clamp(17px, 2vw, 24px); line-height: 1.55; }
      ul { margin: 0; padding: 0; display: grid; gap: 12px; }
      li {
        list-style: none;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.78);
        padding: 13px 14px;
        color: #273831;
        line-height: 1.5;
      }
      .slide-number {
        align-self: start;
        justify-self: end;
        color: #8d6500;
        font-weight: 900;
        font-size: clamp(42px, 8vw, 88px);
        line-height: 1;
      }
      .progress {
        position: fixed;
        left: 14px;
        right: 14px;
        bottom: 12px;
        display: flex;
        justify-content: center;
        gap: 6px;
        pointer-events: none;
      }
      .progress span {
        width: 28px;
        height: 4px;
        border-radius: 999px;
        background: rgba(23, 126, 114, 0.28);
      }
      .progress span:first-child { background: var(--accent); }
      @media (max-width: 760px) {
        .frame { grid-template-columns: 1fr; align-items: start; }
        .slide-number { justify-self: start; font-size: 38px; }
        .slide { padding: 24px 16px 56px; }
        li { padding: 12px; }
      }
      @media print {
        .deck { overflow: visible; }
        .slide { page-break-after: always; }
        .progress { display: none; }
      }
    </style>
  </head>
  <body>
    <main class="deck">
      ${slides.map((slide, index) => `
      <section class="slide">
        <div class="frame">
          <div>
            <span class="eyebrow">${escapeHtml(slide.eyebrow)}</span>
            ${index === 0 ? `<h1>${escapeHtml(slide.title)}</h1>` : `<h2>${escapeHtml(slide.title)}</h2>`}
            <p>${escapeHtml(slide.subtitle)}</p>
          </div>
          <div>
            <div class="slide-number">${String(index + 1).padStart(2, '0')}</div>
            <ul>
              ${slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('\n              ')}
            </ul>
          </div>
        </div>
      </section>`).join('\n')}
    </main>
    <div class="progress" aria-hidden="true">
      ${slides.map(() => '<span></span>').join('')}
    </div>
  </body>
</html>`;
}

function publicBriefForContentTask(task: TaskRecord, parent: TaskRecord | null, topic: string, strategy: WorkStrategy): TaskPublicBrief {
  const source = parent?.planning_metadata.publicBrief ?? parent?.planning_metadata.taskContract ?? task.planning_metadata.publicBrief ?? task.planning_metadata.taskContract;
  const raw = isRecord(source) && isRecord(source.publicBrief) ? source.publicBrief : source;
  if (isRecord(raw) && typeof raw.title === 'string' && typeof raw.subject === 'string') {
    return {
      originalRequest: typeof raw.originalRequest === 'string' ? raw.originalRequest : topic,
      title: raw.title,
      subject: raw.subject,
      audience: typeof raw.audience === 'string' ? raw.audience : '目标听众',
      pageCount: typeof raw.pageCount === 'number' ? raw.pageCount : undefined,
      style: typeof raw.style === 'string' ? raw.style : '简洁商务',
      purpose: typeof raw.purpose === 'string' ? raw.purpose : '交付清晰、可复用、可继续迭代的内容成果。',
      mustInclude: Array.isArray(raw.mustInclude) ? raw.mustInclude.filter((item): item is string => typeof item === 'string') : [],
      outputLanguage: typeof raw.outputLanguage === 'string' ? raw.outputLanguage : '中文',
      deliverableKind: typeof raw.deliverableKind === 'string' ? raw.deliverableKind : strategy.delivery.kind
    };
  }
  return {
    originalRequest: topic,
    title: shortTitle(topic),
    subject: shortTitle(topic),
    audience: '目标听众',
    style: '简洁商务',
    purpose: '交付清晰、可复用、可继续迭代的内容成果。',
    mustInclude: [],
    outputLanguage: '中文',
    deliverableKind: strategy.delivery.kind
  };
}

function deliverableAgentPromptForContentTask(task: TaskRecord, parent: TaskRecord | null) {
  const source = parent?.planning_metadata.taskContract ?? task.planning_metadata.taskContract;
  const deliverableAgent = isRecord(source) && isRecord(source.deliverableAgent) ? source.deliverableAgent : null;
  const prompt = typeof deliverableAgent?.prompt === 'string' ? deliverableAgent.prompt.trim() : '';
  const agentId = typeof deliverableAgent?.agentId === 'string' ? deliverableAgent.agentId : '';
  const output = typeof deliverableAgent?.output === 'string' ? deliverableAgent.output : '';
  if (agentId !== 'content' || output !== 'slide_deck_spec_json' || !prompt) {
    throw new Error('presentation_deck_missing_top_level_agent_prompt');
  }
  return prompt;
}

function audienceNextSteps(brief: TaskPublicBrief) {
  return [
    `确认这份材料是否面向 ${brief.audience}，以及最终使用场景。`,
    `补充 ${brief.subject} 的真实数据、案例、截图或客户证据。`,
    '决定下一步是继续精修内容、补设计稿，还是导出正式 PPTX。'
  ];
}

function shortTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80) || 'AI 交付物';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function browserResultFor(taskId: string) {
  const result = await browserRunner.runTask(taskId);
  if (!result) {
    return 'Browser worker did not find a browser run linked to this task.';
  }
  return `${result.summary}\nEvidence: ${result.artifactPath}`;
}

async function campaignSendResultFor(metadata: Record<string, unknown>) {
  const campaignId = typeof metadata.campaignId === 'string' ? metadata.campaignId : '';
  if (!campaignId) {
    return 'Campaign email sender could not run: missing campaignId.';
  }
  const result = await campaignEmailSender.sendCampaign(campaignId);
  return [
    `Campaign email sender completed for ${campaignId}.`,
    `status:${result.status}`,
    `sent:${result.sentCount} skipped:${result.skippedCount} failed:${result.failedCount}`,
    result.reason ? `reason:${result.reason}` : '',
    result.eventIds.length ? `events:${result.eventIds.join(', ')}` : 'events:none'
  ].filter(Boolean).join('\n');
}

async function continueParentWorkflow(completedTask: TaskRecord) {
  if (!completedTask.parent_task_id) return;

  const parent = await repos.getTask(completedTask.parent_task_id);
  if (!parent) return;

  const subtasks = await repos.listSubtasks(parent.id);
  const ordered = subtasks
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.created_at.localeCompare(b.created_at));
  const hasActiveSubtask = ordered.some((task) => ['queued', 'running'].includes(task.status));
  if (hasActiveSubtask) return;

  const next = ordered.find((task) => task.status === 'planned' || task.status === 'waiting_external' || task.status === 'blocked' || task.status === 'failed');
  if (next) {
    const previousIncomplete = ordered
      .filter((task) => (task.sequence ?? 0) < (next.sequence ?? 0))
      .find((task) => !['done', 'cancelled'].includes(task.status));
    if (previousIncomplete) {
      await notifyTaskLifecycle(next.id, [
        `等待前置步骤：${previousIncomplete.title}`,
        '任务会保持顺序执行，不会跳过中间步骤。'
      ]);
      return;
    }

    const job = await taskDispatcher.enqueueTask({
      taskId: next.id,
      source: 'intake'
    });
    await repos.updateTaskStatus(next.id, 'queued', job.jobId ? `Auto queued after ${completedTask.id} as job ${job.jobId}` : `Auto queued after ${completedTask.id}`);
    await repos.audit({
      actorType: 'system',
      action: 'workflow_next_subtask_queued',
      entityType: 'task',
      entityId: next.id,
      metadata: {
        parentTaskId: parent.id,
        completedTaskId: completedTask.id,
        jobId: job.jobId
      }
    });
    await notifyTaskLifecycle(parent.id, [`下一步已启动：${next.sequence ?? '?'} ${next.title}`]);
    return;
  }

  const allDone = ordered.length > 0 && ordered.every((task) => ['done', 'cancelled'].includes(task.status));
  if (!allDone) return;

  const result = [
    `工作流已完成：${parent.title}`,
    '',
    ...ordered.map((task) => [
      `${task.sequence ?? '-'} ${task.title}: ${task.status}`,
      task.result ? `   ${taskResultSummary(task.result)}` : ''
    ].filter(Boolean).join('\n'))
  ].join('\n');
  await repos.completeTask(parent.id, result);
  await repos.audit({
    actorType: 'system',
    action: 'workflow_parent_completed',
    entityType: 'task',
    entityId: parent.id,
    metadata: {
      completedSubtaskIds: ordered.map((task) => task.id)
    }
  });
  await notifyTaskLifecycle(parent.id, ['所有步骤已完成，父任务已关闭。']);
}

async function notifyTaskLifecycle(taskId: string, extraLines: string[]) {
  const target = await repos.getTaskTelegramTarget(taskId);
  if (!target) return;

  const task = await repos.getTask(taskId);
  if (!task) return;
  const displayTask = task.parent_task_id ? await repos.getTask(task.parent_task_id) ?? task : task;
  const subtasks = await repos.listSubtasks(displayTask.id);
  const card = buildTaskDetailCard(displayTask, subtasks, config, extraLines.filter(Boolean));

  await repos.createOutboundMessage({
    chatId: target.chatId,
    text: card.text,
    raw: {
      source: 'worker_lifecycle_notification',
      taskId,
      displayTaskId: displayTask.id
    }
  });
  await telegramClient.sendMessage(target.telegramChatId, card.text, { replyMarkup: card.replyMarkup });
}

function summarizeResult(result: string) {
  const first = result.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first ? `结果摘要：${first.slice(0, 220)}` : '';
}

function taskResultSummary(result: string) {
  return result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' / ')
    .slice(0, 260);
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repositories } from '../db/repositories.js';
import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';

type PersonaVoice = {
  displayName: string;
  communicationStyle: Record<string, unknown>;
  boundaries: string[];
  valuesOrder: string[];
};

async function loadVoice(repos: Repositories): Promise<PersonaVoice | null> {
  const profile = await repos.getASelfProfile().catch(() => null);
  if (!profile) return null;
  return {
    displayName: profile.display_name,
    communicationStyle: (profile.communication_style ?? {}) as Record<string, unknown>,
    boundaries: toArray(profile.boundaries),
    valuesOrder: toArray(profile.values_order)
  };
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function voiceBlock(voice: PersonaVoice | null) {
  if (!voice) return '（人格未蒸馏，用克制专业、不过度承诺的语气）';
  return [
    `你在替 ${voice.displayName} 输出内容，必须像本人写的。`,
    `沟通风格：${JSON.stringify(voice.communicationStyle)}`,
    `绝不做：${voice.boundaries.join(' | ') || '未设定'}`,
    `价值排序：${voice.valuesOrder.join(' | ') || '未设定'}`
  ].join('\n');
}

async function askJson<T>(
  config: AppConfig,
  system: string,
  prompt: string,
  temperature = 0.3
): Promise<T> {
  const provider = createModelProviderFromConfig(config);
  if (!provider) throw new Error('ai_provider_not_configured');
  const response = await provider.chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    temperature
  });
  const raw = (response.content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(raw) as T;
}

/* ------------------------- PPT ------------------------- */

const deckSchema = z.object({
  topic: z.string().trim().min(1).max(300),
  audience: z.string().trim().max(80).default('客户'),
  slideCount: z.coerce.number().int().min(4).max(20).default(10),
  style: z.string().trim().max(80).default('简洁商务'),
  goal: z.string().trim().max(500).optional(),
  material: z.string().trim().max(20000).optional()
});

type DeckSlide = {
  title: string;
  subtitle?: string;
  bullets: string[];
  speakerNotes?: string;
  layout?: 'cover' | 'content' | 'metrics' | 'closing';
};

type DeckPlan = { deckTitle: string; deckSubtitle: string; slides: DeckSlide[] };

function renderDeckHtml(plan: DeckPlan, style: string) {
  const esc = (s: string) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
    );

  const slides = plan.slides
    .map((slide, index) => {
      const layout = slide.layout ?? (index === 0 ? 'cover' : 'content');
      const bullets = (slide.bullets ?? []).map((b) => `<li>${esc(b)}</li>`).join('');
      return `
      <section class="slide slide-${layout}">
        <div class="slide-index">${index + 1} / ${plan.slides.length}</div>
        <h2>${esc(slide.title)}</h2>
        ${slide.subtitle ? `<p class="slide-sub">${esc(slide.subtitle)}</p>` : ''}
        ${bullets ? `<ul>${bullets}</ul>` : ''}
        ${slide.speakerNotes ? `<div class="notes"><span>演讲备注</span>${esc(slide.speakerNotes)}</div>` : ''}
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.deckTitle)}</title>
<style>
:root{--ink:#14231d;--muted:#6b7b73;--line:#dfe6e0;--accent:#1f7a55;--bg:#f4f6f3}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--ink);
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.6}
.deck-head{max-width:900px;margin:0 auto 24px}
.deck-head h1{margin:0 0 6px;font-size:26px}
.deck-head p{margin:0;color:var(--muted)}
.slide{max-width:900px;margin:0 auto 18px;background:#fff;border:1px solid var(--line);
border-radius:12px;padding:32px 36px;position:relative;box-shadow:0 1px 2px rgba(20,35,29,.04)}
.slide-index{position:absolute;top:16px;right:20px;font-size:12px;color:var(--muted)}
.slide h2{margin:0 0 10px;font-size:22px;line-height:1.35}
.slide-sub{margin:0 0 16px;color:var(--muted);font-size:14px}
.slide ul{margin:0;padding-left:20px}
.slide li{margin:9px 0;font-size:15px}
.slide-cover{background:linear-gradient(135deg,#14231d,#1f7a55);color:#fff;border:0;padding:48px 36px}
.slide-cover h2{font-size:30px}
.slide-cover .slide-sub,.slide-cover .slide-index{color:rgba(255,255,255,.75)}
.slide-closing{border-left:4px solid var(--accent)}
.slide-metrics li{font-variant-numeric:tabular-nums}
.notes{margin-top:18px;padding-top:14px;border-top:1px dashed var(--line);font-size:13px;color:var(--muted)}
.notes span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.slide-cover .notes{border-color:rgba(255,255,255,.25);color:rgba(255,255,255,.8)}
@media print{body{background:#fff;padding:0}.slide{page-break-after:always;box-shadow:none;margin:0;border-radius:0;min-height:100vh}}
</style></head>
<body>
<div class="deck-head"><h1>${esc(plan.deckTitle)}</h1><p>${esc(plan.deckSubtitle)} · ${esc(style)}</p></div>
${slides}
</body></html>`;
}

/* ------------------------- Mail ------------------------- */

const mailDraftSchema = z.object({
  recipient: z.string().trim().min(1).max(200),
  goal: z.string().trim().min(1).max(500),
  tone: z.string().trim().max(40).default('专业简洁'),
  context: z.string().trim().max(8000).optional(),
  language: z.enum(['zh', 'en']).default('zh')
});

/* ------------------------- CRM import ------------------------- */

const crmParseSchema = z.object({
  source: z.string().trim().max(120).optional(),
  raw: z.string().trim().min(1).max(30000)
});

type ParsedLead = {
  name: string;
  organizationName?: string;
  email?: string;
  phone?: string;
  interest?: string;
  note: string;
  score?: number;
  scoreReason?: string;
};

const crmCommitSchema = z.object({
  leads: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    organizationName: z.string().trim().max(160).optional(),
    interest: z.string().trim().max(200).optional(),
    note: z.string().trim().min(1).max(4000)
  })).min(1).max(100)
});

/* ------------------------- Finance import ------------------------- */

const financeParseSchema = z.object({
  source: z.string().trim().max(120).optional(),
  currency: z.string().trim().max(8).default('CNY'),
  raw: z.string().trim().min(1).max(30000)
});

type ParsedTxn = {
  direction: 'income' | 'expense';
  amount: number;
  counterparty?: string;
  category?: string;
  description: string;
  occurredAt?: string;
  confidence?: number;
};

const financeCommitSchema = z.object({
  currency: z.string().trim().max(8).default('CNY'),
  entries: z.array(z.object({
    direction: z.enum(['income', 'expense']),
    amount: z.number().positive().max(1_000_000_000),
    counterparty: z.string().trim().max(160).optional(),
    category: z.string().trim().max(80).optional(),
    description: z.string().trim().min(1).max(2000)
  })).min(1).max(200)
});

/* ------------------------- Finance action ------------------------- */

const financeActionSchema = z.object({
  intent: z.string().trim().min(1).max(4000),
  currency: z.string().trim().max(8).default('CNY')
});

type FinanceProposal = {
  kind: 'transaction' | 'invoice' | 'subscription' | 'payment';
  direction?: 'income' | 'expense';
  amount: number;
  counterparty?: string;
  customerName?: string;
  vendorName?: string;
  category?: string;
  interval?: string;
  dueAt?: string;
  nextBillingAt?: string;
  description: string;
  requiresApproval: boolean;
  riskReason?: string;
  missing?: string[];
};

const financeActionCommitSchema = z.object({
  currency: z.string().trim().max(8).default('CNY'),
  proposal: z.object({
    kind: z.enum(['transaction', 'invoice', 'subscription', 'payment']),
    direction: z.enum(['income', 'expense']).optional(),
    amount: z.number().positive().max(1_000_000_000),
    counterparty: z.string().trim().max(160).optional(),
    customerName: z.string().trim().max(160).optional(),
    vendorName: z.string().trim().max(160).optional(),
    category: z.string().trim().max(80).optional(),
    interval: z.string().trim().max(40).optional(),
    dueAt: z.string().trim().max(40).optional(),
    nextBillingAt: z.string().trim().max(40).optional(),
    description: z.string().trim().min(1).max(2000),
    requiresApproval: z.boolean().default(false)
  })
});

/* ------------------------- Agent settings ------------------------- */

const permissionPatchSchema = z.object({
  automationMode: z.enum(['auto', 'reviewable_auto', 'semi_auto', 'human_required']).optional(),
  requiresApproval: z.boolean().optional()
});

const preferenceSchema = z.object({
  scope: z.enum(['model', 'communication', 'skill', 'operating']),
  content: z.string().trim().min(1).max(4000),
  importance: z.enum(['normal', 'high', 'critical']).default('normal')
});

/* ------------------------- Knowledge import ------------------------- */

const knowledgeParseSchema = z.object({
  category: z.string().trim().max(80).default('company'),
  source: z.string().trim().max(160).optional(),
  raw: z.string().trim().min(1).max(40000)
});

type ParsedKnowledge = {
  category: string;
  title: string;
  content: string;
  why?: string;
  tags?: string[];
  confidence?: number;
};

const knowledgeCommitSchema = z.object({
  items: z.array(z.object({
    category: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(12000),
    why: z.string().trim().max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    confidence: z.number().min(0).max(1).optional()
  })).min(1).max(80),
  source: z.string().trim().max(160).optional()
});

export function registerStudioRoutes(
  app: FastifyInstance<any, any, any, any>,
  config: AppConfig,
  repos: Repositories,
  allowWebConsoleAccess: any
) {
  const opts = { preHandler: allowWebConsoleAccess };

  // ---- PPT: generate real deck ----
  app.post<{ Body: unknown }>('/api/web/studio/deck', opts, async (request, reply) => {
    const parsed = deckSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_deck_request', issues: parsed.error.issues };
    }
    const input = parsed.data;
    const voice = await loadVoice(repos);

    const prompt = [
      voiceBlock(voice),
      '',
      `请为以下主题生成一份 ${input.slideCount} 页的演示文稿内容。`,
      `主题：${input.topic}`,
      `受众：${input.audience}`,
      `风格：${input.style}`,
      input.goal ? `这份 PPT 要达成的目标：${input.goal}` : '',
      input.material ? `可用素材（必须优先使用其中的真实信息，不要编造数字）：\n${input.material}` : '没有提供素材，请基于主题构建合理框架，不要编造具体数字或客户名。',
      '',
      '要求：',
      '1. 第一页是封面（layout=cover），最后一页是行动号召（layout=closing）。',
      '2. 含数据的页面 layout 用 metrics，其余用 content。',
      '3. 每页 bullets 控制在 3-5 条，每条是完整有信息量的句子，不要写"介绍产品"这种空标题。',
      '4. speakerNotes 写这一页要口头补充什么，一到两句。',
      '5. 没有真实数据时不要编造百分比和金额。',
      '',
      '严格输出原始 JSON（不要 markdown 代码块）：',
      '{"deckTitle":"","deckSubtitle":"","slides":[{"title":"","subtitle":"","bullets":[""],"speakerNotes":"","layout":"cover"}]}'
    ].filter(Boolean).join('\n');

    try {
      const plan = await askJson<DeckPlan>(
        config,
        '你是资深商业演示设计师。输出严格的原始 JSON。',
        prompt,
        0.4
      );
      const slides = Array.isArray(plan.slides) ? plan.slides.slice(0, input.slideCount) : [];
      if (!slides.length) throw new Error('empty_deck');
      const finalPlan: DeckPlan = {
        deckTitle: plan.deckTitle || input.topic,
        deckSubtitle: plan.deckSubtitle || `面向${input.audience}`,
        slides
      };
      const html = renderDeckHtml(finalPlan, input.style);
      const artifact = await repos.createArtifact({
        type: 'slide_deck_html',
        title: finalPlan.deckTitle,
        content: html,
        metadata: {
          source: 'studio_deck',
          topic: input.topic,
          audience: input.audience,
          style: input.style,
          slideCount: slides.length,
          plan: finalPlan
        }
      });
      return { ok: true, artifact: { id: artifact.id, title: artifact.title }, plan: finalPlan, previewUrl: `/app/deliverables/${artifact.id}` };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'deck_generation_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- Mail: draft in owner voice ----
  app.post<{ Body: unknown }>('/api/web/studio/mail-draft', opts, async (request, reply) => {
    const parsed = mailDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_mail_request', issues: parsed.error.issues };
    }
    const input = parsed.data;
    const voice = await loadVoice(repos);

    const prompt = [
      voiceBlock(voice),
      '',
      '写一封邮件。',
      `收件人：${input.recipient}`,
      `目标：${input.goal}`,
      `语气：${input.tone}`,
      `语言：${input.language === 'en' ? 'English' : '中文'}`,
      input.context ? `背景信息（必须利用，不要编造）：\n${input.context}` : '没有额外背景，不要编造双方过往的具体互动。',
      '',
      '要求：',
      '1. 主题行要具体，不要写"关于合作"这种模糊标题。',
      '2. 正文控制在 5 句以内，开门见山，不要"希望您一切安好"这类客套开场。',
      '3. 结尾给一个明确的、低门槛的下一步（比如约 15 分钟通话）。',
      '4. 绝不承诺价格、折扣、交付日期。',
      '5. 如果有需要老板确认才能写进去的信息，放进 needsOwnerInput 数组。',
      '',
      '严格输出原始 JSON：',
      '{"subject":"","body":"","needsOwnerInput":[""],"reasoning":""}'
    ].join('\n');

    try {
      const draft = await askJson<{ subject: string; body: string; needsOwnerInput?: string[]; reasoning?: string }>(
        config,
        '你是替老板写商务邮件的助手。输出严格的原始 JSON。',
        prompt,
        0.5
      );
      return {
        ok: true,
        draft: {
          subject: draft.subject ?? '',
          body: draft.body ?? '',
          needsOwnerInput: Array.isArray(draft.needsOwnerInput) ? draft.needsOwnerInput : [],
          reasoning: draft.reasoning ?? ''
        },
        personaApplied: Boolean(voice)
      };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'mail_draft_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- CRM: parse messy list into structured leads ----
  app.post<{ Body: unknown }>('/api/web/studio/crm-parse', opts, async (request, reply) => {
    const parsed = crmParseSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_crm_request', issues: parsed.error.issues };
    }
    const input = parsed.data;

    const prompt = [
      '把下面这份杂乱的名单解析成结构化线索。',
      input.source ? `来源：${input.source}` : '',
      '',
      '原始内容：',
      input.raw,
      '',
      '要求：',
      '1. 只提取原文里真实存在的信息，缺失字段就省略，绝对不要编造邮箱或电话。',
      '2. note 用一句话概括这个人的关键信息和可切入点。',
      '3. score 是 0-100 的意向评分，scoreReason 说明依据（比如"明确提到预算"得分高）。',
      '4. 如果原文是一段描述而不是名单，尽力提取出其中提到的人和公司。',
      '',
      '严格输出原始 JSON 数组：',
      '[{"name":"","organizationName":"","email":"","phone":"","interest":"","note":"","score":70,"scoreReason":""}]'
    ].filter(Boolean).join('\n');

    try {
      const leads = await askJson<ParsedLead[]>(
        config,
        '你是 CRM 数据清洗引擎。输出严格的原始 JSON 数组。',
        prompt,
        0.2
      );
      const list = Array.isArray(leads) ? leads.filter((l) => l && typeof l.name === 'string' && l.name.trim()) : [];
      return { ok: true, leads: list.slice(0, 100), count: list.length };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'crm_parse_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post<{ Body: unknown }>('/api/web/studio/crm-commit', opts, async (request, reply) => {
    const parsed = crmCommitSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_crm_commit', issues: parsed.error.issues };
    }
    const created: string[] = [];
    const failed: Array<{ name: string; message: string }> = [];
    for (const lead of parsed.data.leads) {
      try {
        const result = await repos.createCrmLead(lead);
        created.push(result.contact.id);
      } catch (err) {
        failed.push({ name: lead.name, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok: true, created: created.length, failed };
  });

  // ---- Finance: parse statement into categorized entries ----
  app.post<{ Body: unknown }>('/api/web/studio/finance-parse', opts, async (request, reply) => {
    const parsed = financeParseSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_finance_request', issues: parsed.error.issues };
    }
    const input = parsed.data;

    const prompt = [
      '把下面的账单/流水解析成结构化记账条目。',
      input.source ? `来源：${input.source}` : '',
      `默认币种：${input.currency}`,
      '',
      '原始内容：',
      input.raw,
      '',
      '要求：',
      '1. 金额必须是原文中真实出现的数字，绝对不要估算或编造。',
      '2. direction 判断：钱进来是 income，钱出去是 expense。',
      '3. category 用中文常见科目，比如：服务收入、云服务、订阅软件、差旅、外包、税费。',
      '4. confidence 是 0-1，表示你对这条解析的把握；看不清的条目给低分并在 description 里说明。',
      '5. occurredAt 用 ISO 日期，原文没有日期就省略。',
      '',
      '严格输出原始 JSON 数组：',
      '[{"direction":"expense","amount":128,"counterparty":"","category":"","description":"","occurredAt":"","confidence":0.9}]'
    ].filter(Boolean).join('\n');

    try {
      const entries = await askJson<ParsedTxn[]>(
        config,
        '你是财务流水解析引擎。输出严格的原始 JSON 数组。',
        prompt,
        0.1
      );
      const list = Array.isArray(entries)
        ? entries.filter((e) => e && Number(e.amount) > 0 && (e.direction === 'income' || e.direction === 'expense'))
        : [];
      const income = list.filter((e) => e.direction === 'income').reduce((sum, e) => sum + Number(e.amount), 0);
      const expense = list.filter((e) => e.direction === 'expense').reduce((sum, e) => sum + Number(e.amount), 0);
      return {
        ok: true,
        currency: input.currency,
        entries: list.slice(0, 200),
        summary: { count: list.length, income, expense, net: income - expense }
      };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'finance_parse_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post<{ Body: unknown }>('/api/web/studio/finance-commit', opts, async (request, reply) => {
    const parsed = financeCommitSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_finance_commit', issues: parsed.error.issues };
    }
    const created: string[] = [];
    const failed: Array<{ description: string; message: string }> = [];
    for (const entry of parsed.data.entries) {
      try {
        const result = await repos.createFinanceEntry({
          kind: 'transaction',
          direction: entry.direction,
          amount: entry.amount,
          currency: parsed.data.currency,
          counterparty: entry.counterparty,
          category: entry.category,
          description: entry.description
        });
        if (result.transaction) created.push(result.transaction.id);
      } catch (err) {
        failed.push({ description: entry.description, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok: true, created: created.length, failed };
  });

  /* ---------------- Finance action: intent -> structured proposal ---------------- */
  app.post<{ Body: unknown }>('/api/web/studio/finance-action', opts, async (request, reply) => {
    const parsed = financeActionSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_finance_action', issues: parsed.error.issues };
    }
    const input = parsed.data;
    const dashboard = await repos.getFinanceDashboard().catch(() => null);

    const prompt = [
      '把老板这句话变成一条可执行的财务动作提案。',
      '',
      '老板原话：',
      input.intent,
      '',
      `默认币种：${input.currency}`,
      dashboard
        ? `当前财务状况参考：本月收入 ${dashboard.monthlyIncome}，本月支出 ${dashboard.monthlyExpenses}，净现金流 ${dashboard.netCashflow}，未结发票 ${dashboard.openInvoices.length} 张。`
        : '',
      '',
      '要求：',
      '1. kind 判断：已经发生的收支记账用 transaction；给客户开票用 invoice；周期订阅用 subscription；还没付出去、需要授权才能执行的付款用 payment。',
      '2. amount 必须来自原话中的真实金额，没有金额就返回 0 并把缺失项写进 missing。',
      '3. requiresApproval：payment 一律 true；单笔支出金额较大或影响现金流的也为 true，并在 riskReason 说明原因（结合上面的现金流数据）。',
      '4. description 一句话说清这笔钱是什么，不要复述原话。',
      '5. missing 列出还缺哪些必要信息（比如收款账户、到期日）。',
      '',
      '严格输出原始 JSON：',
      '{"kind":"transaction","direction":"expense","amount":0,"counterparty":"","customerName":"","vendorName":"","category":"","interval":"monthly","dueAt":"","nextBillingAt":"","description":"","requiresApproval":false,"riskReason":"","missing":[]}'
    ].filter(Boolean).join('\n');

    try {
      const proposal = await askJson<FinanceProposal>(
        config,
        '你是财务操作解析引擎。输出严格的原始 JSON 对象。',
        prompt,
        0.1
      );
      return {
        ok: true,
        currency: input.currency,
        proposal,
        snapshot: dashboard
          ? {
              currency: dashboard.currency,
              monthlyIncome: dashboard.monthlyIncome,
              monthlyExpenses: dashboard.monthlyExpenses,
              netCashflow: dashboard.netCashflow,
              openInvoices: dashboard.openInvoices.length,
              riskAlerts: dashboard.riskAlerts?.slice(0, 3) ?? []
            }
          : null
      };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'finance_action_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post<{ Body: unknown }>('/api/web/studio/finance-action/commit', opts, async (request, reply) => {
    const parsed = financeActionCommitSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_finance_action_commit', issues: parsed.error.issues };
    }
    const { currency, proposal } = parsed.data;

    if (proposal.kind === 'payment' || proposal.requiresApproval) {
      const approval = await repos.createApproval({
        actionType: proposal.kind === 'payment' ? 'payment' : 'financial_commitment',
        riskLevel: 'high',
        prompt: `${proposal.description}（${proposal.counterparty ?? proposal.vendorName ?? proposal.customerName ?? '未指定对象'} ${proposal.amount} ${currency}）`,
        payload: { ...proposal, currency, origin: 'finance_studio' }
      });
      return { ok: true, mode: 'approval', approval };
    }

    if (proposal.kind === 'invoice') {
      const result = await repos.createFinanceEntry({
        kind: 'invoice',
        customerName: proposal.customerName || proposal.counterparty || '未命名客户',
        amount: proposal.amount,
        currency,
        status: 'sent',
        dueAt: proposal.dueAt,
        description: proposal.description
      } as never);
      return { ok: true, mode: 'invoice', result };
    }

    if (proposal.kind === 'subscription') {
      const result = await repos.createFinanceEntry({
        kind: 'subscription',
        vendorName: proposal.vendorName || proposal.counterparty || '未命名供应商',
        amount: proposal.amount,
        currency,
        interval: proposal.interval || 'monthly',
        nextBillingAt: proposal.nextBillingAt,
        category: proposal.category,
        description: proposal.description
      } as never);
      return { ok: true, mode: 'subscription', result };
    }

    const result = await repos.createFinanceEntry({
      kind: 'transaction',
      direction: proposal.direction ?? 'expense',
      amount: proposal.amount,
      currency,
      counterparty: proposal.counterparty,
      category: proposal.category,
      description: proposal.description
    } as never);
    return { ok: true, mode: 'transaction', result };
  });

  /* ---------------- Agent settings ---------------- */
  app.get('/api/web/studio/agent-settings', opts, async () => {
    const [profile, permissions, preferences] = await Promise.all([
      repos.getASelfProfile().catch(() => null),
      repos.listASelfPermissionRules().catch(() => []),
      repos.listMemories({ limit: 30, type: 'preference' }).catch(() => [])
    ]);
    return {
      ok: true,
      ai: {
        provider: config.ai.provider,
        model: config.ai.openaiModel,
        agentEnabled: config.ai.agentEnabled,
        baseUrlConfigured: Boolean(config.ai.openaiBaseUrl),
        apiKeyConfigured: Boolean(config.ai.openaiApiKey)
      },
      persona: profile
        ? {
            displayName: profile.display_name,
            status: profile.status,
            confidence: Number(profile.confidence) || 0,
            boundaries: toArray(profile.boundaries),
            valuesOrder: toArray(profile.values_order)
          }
        : null,
      permissions,
      preferences: preferences.map((item: any) => ({
        id: item.id,
        content: item.content,
        importance: item.importance,
        createdAt: item.created_at,
        scope: (item.metadata && item.metadata.scope) || 'operating'
      }))
    };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/web/studio/agent-settings/permissions/:id',
    opts,
    async (request, reply) => {
      const parsed = permissionPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'invalid_permission_patch', issues: parsed.error.issues };
      }
      const rule = await repos.updateASelfPermissionRule(request.params.id, parsed.data);
      if (!rule) {
        reply.code(404);
        return { ok: false, error: 'permission_rule_not_found' };
      }
      await repos.audit({
        actorType: 'web_console',
        action: 'a_self_permission_updated',
        entityType: 'a_self_permission_rule',
        entityId: rule.id,
        metadata: parsed.data
      });
      return { ok: true, rule };
    }
  );

  app.post<{ Body: unknown }>('/api/web/studio/agent-settings/preferences', opts, async (request, reply) => {
    const parsed = preferenceSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_preference', issues: parsed.error.issues };
    }
    const memory = await repos.createMemory({
      type: 'preference',
      content: parsed.data.content,
      importance: parsed.data.importance,
      metadata: { scope: parsed.data.scope, source: 'agent_settings_studio' }
    });
    return { ok: true, memory };
  });

  /* ---------------- Knowledge import ---------------- */
  app.post<{ Body: unknown }>('/api/web/studio/knowledge-parse', opts, async (request, reply) => {
    const parsed = knowledgeParseSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_knowledge_request', issues: parsed.error.issues };
    }
    const input = parsed.data;

    const prompt = [
      '把下面这份原始材料拆成可长期复用的知识条目，存进数字自我的记忆库。',
      input.source ? `来源：${input.source}` : '',
      `建议归类到：${input.category}`,
      '',
      '原始材料：',
      input.raw,
      '',
      '要求：',
      '1. 一条知识只讲一件事，标题就是这条知识的结论，不要写"关于定价"这种目录式标题。',
      '2. content 要能被未来的自己直接拿来用，保留具体数字、条件、边界。',
      '3. why 写这条知识背后的原因或代价（为什么这么定、踩过什么坑），这是最有价值的部分，能推断就一定要写。',
      '4. 不要复述原文流水账，也绝不编造原文没有的事实。',
      '5. tags 用 2-4 个短词，方便以后检索。',
      '6. confidence 表示这条知识的可靠度：原文明确写了给 0.9，靠推断给 0.5。',
      '',
      '严格输出原始 JSON 数组：',
      '[{"category":"pricing","title":"","content":"","why":"","tags":[""],"confidence":0.8}]'
    ].filter(Boolean).join('\n');

    try {
      const items = await askJson<ParsedKnowledge[]>(
        config,
        '你是个人知识库结构化引擎。输出严格的原始 JSON 数组。',
        prompt,
        0.2
      );
      const list = Array.isArray(items)
        ? items.filter((item) => item && typeof item.title === 'string' && item.title.trim() && typeof item.content === 'string' && item.content.trim())
        : [];
      return { ok: true, items: list.slice(0, 80), count: list.length };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'knowledge_parse_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post<{ Body: unknown }>('/api/web/studio/knowledge-commit', opts, async (request, reply) => {
    const parsed = knowledgeCommitSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_knowledge_commit', issues: parsed.error.issues };
    }
    const created: string[] = [];
    const failed: Array<{ title: string; message: string }> = [];
    for (const item of parsed.data.items) {
      try {
        const record = await repos.createASelfMemoryItem({
          category: item.category,
          title: item.title,
          content: item.content,
          why: item.why || null,
          tags: item.tags ?? [],
          source: 'knowledge_studio',
          confidence: item.confidence ?? 0.6,
          metadata: { source: 'knowledge_studio', origin: parsed.data.source ?? null }
        });
        created.push(record.id);
      } catch (err) {
        failed.push({ title: item.title, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok: true, created: created.length, failed };
  });
}

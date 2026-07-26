import type { Repositories } from '../db/repositories.js';
import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';

type PersonaBrief = {
  displayName: string;
  mission: string;
  valuesOrder: string[];
  decisionPrinciples: string[];
  boundaries: string[];
  communicationStyle: Record<string, unknown>;
  decisionRules: Array<{ question: string; choice: string; rule: string | null }>;
};

type OpcSnapshot = {
  crm: {
    hotLeads: number;
    openOpportunities: number;
    overdueFollowUps: number;
    riskContacts: number;
    hotLeadNames: string[];
    overdueNotes: string[];
  };
  finance: {
    currency: string;
    monthlyIncome: number;
    monthlyExpenses: number;
    netCashflow: number;
    openInvoices: number;
    riskAlerts: string[];
  };
  tasks: { active: number; done: number; blocked: number; activeTitles: string[] };
  approvals: number;
  calendar: { today: number; tomorrow: number; conflicts: number };
};

export type OpcAdvice = {
  headline: string;
  companyState: string;
  marketScan: string | null;
  moves: Array<{
    title: string;
    why: string;
    kind: 'revenue' | 'relationship' | 'risk' | 'ops';
    urgency: 'now' | 'today' | 'this_week';
    suggestedAction: string;
    personaBasis: string;
  }>;
};

export async function collectOpcSnapshot(repos: Repositories): Promise<OpcSnapshot> {
  const [crm, finance, activeTasks, doneTasks, approvals, calendar] = await Promise.all([
    repos.getCrmDashboard().catch(() => null),
    repos.getFinanceDashboard().catch(() => null),
    repos.listTasksByStatuses(['new', 'intake', 'planned', 'queued', 'running', 'blocked', 'review'], 20).catch(() => []),
    repos.listTasksByStatuses(['done'], 20).catch(() => []),
    repos.listPendingApprovals(20).catch(() => []),
    repos.getCalendarDashboard().catch(() => null)
  ]);

  const anyCrm = (crm ?? {}) as Record<string, any[]>;
  const anyFin = (finance ?? {}) as Record<string, any>;
  const anyCal = (calendar ?? {}) as Record<string, any[]>;

  return {
    crm: {
      hotLeads: anyCrm.hotLeads?.length ?? 0,
      openOpportunities: anyCrm.openOpportunities?.length ?? 0,
      overdueFollowUps: anyCrm.overdueFollowUps?.length ?? 0,
      riskContacts: anyCrm.riskContacts?.length ?? 0,
      hotLeadNames: (anyCrm.hotLeads ?? []).slice(0, 6).map((l: any) => l?.name ?? l?.id).filter(Boolean),
      overdueNotes: (anyCrm.overdueFollowUps ?? []).slice(0, 6).map((f: any) => f?.note).filter(Boolean)
    },
    finance: {
      currency: anyFin.currency ?? 'CNY',
      monthlyIncome: Number(anyFin.monthlyIncome ?? 0),
      monthlyExpenses: Number(anyFin.monthlyExpenses ?? 0),
      netCashflow: Number(anyFin.netCashflow ?? 0),
      openInvoices: anyFin.openInvoices?.length ?? 0,
      riskAlerts: (anyFin.riskAlerts ?? []).slice(0, 6)
    },
    tasks: {
      active: activeTasks.length,
      done: doneTasks.length,
      blocked: activeTasks.filter((t) => t.status === 'blocked').length,
      activeTitles: activeTasks.slice(0, 8).map((t) => t.title)
    },
    approvals: approvals.length,
    calendar: {
      today: anyCal.todayEvents?.length ?? 0,
      tomorrow: anyCal.tomorrowEvents?.length ?? 0,
      conflicts: anyCal.conflicts?.length ?? 0
    }
  };
}

async function loadPersona(repos: Repositories): Promise<PersonaBrief | null> {
  const profile = await repos.getASelfProfile();
  if (!profile) return null;
  const decisions = await repos.listASelfDecisionLogs(10).catch(() => []);
  return {
    displayName: profile.display_name,
    mission: profile.mission,
    valuesOrder: toArray(profile.values_order),
    decisionPrinciples: toArray(profile.decision_principles),
    boundaries: toArray(profile.boundaries),
    communicationStyle: (profile.communication_style ?? {}) as Record<string, unknown>,
    decisionRules: decisions.map((d) => ({ question: d.question, choice: d.choice, rule: d.future_rule }))
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

export async function generateOpcAdvice(
  repos: Repositories,
  config: AppConfig,
  mode: 'morning' | 'evening'
): Promise<{ advice: OpcAdvice; snapshot: OpcSnapshot; persona: PersonaBrief | null; usedLlm: boolean }> {
  const [persona, snapshot] = await Promise.all([loadPersona(repos), collectOpcSnapshot(repos)]);
  const provider = createModelProviderFromConfig(config);

  if (!provider) {
    return { advice: fallbackAdvice(snapshot, mode), snapshot, persona, usedLlm: false };
  }

  const personaBlock = persona
    ? [
        `数字人格：${persona.displayName}`,
        `使命：${persona.mission}`,
        `价值排序：${persona.valuesOrder.join(' | ') || '未设定'}`,
        `决策原则：${persona.decisionPrinciples.join(' | ') || '未设定'}`,
        `禁区：${persona.boundaries.join(' | ') || '未设定'}`,
        `沟通风格：${JSON.stringify(persona.communicationStyle)}`,
        persona.decisionRules.length
          ? `过去沉淀的决策规则：\n${persona.decisionRules.map((r) => `- 遇到「${r.question}」时选择「${r.choice}」，规则：${r.rule ?? '未总结'}`).join('\n')}`
          : '过去决策规则：暂无'
      ].join('\n')
    : '数字人格尚未蒸馏，使用一人公司通用经营常识，并在 headline 里提醒老板补充人格资料。';

  const prompt = [
    mode === 'morning'
      ? '现在是早晨。你要做市场与机会扫描，给出今天最该动手的事。'
      : '现在是晚上。你要做经营复盘，给出明天最该动手的事和今天的经验沉淀。',
    '',
    '=== 老板的人格基因（你必须按这个思考，不要给通用建议）===',
    personaBlock,
    '',
    '=== 公司当前真实经营数据 ===',
    JSON.stringify(snapshot, null, 2),
    '',
    '要求：',
    '1. 每条建议必须引用上面的真实数字，不要编造不存在的客户或金额。',
    '2. 每条建议必须在 personaBasis 里说明它对应老板的哪条价值排序、决策原则或历史规则。',
    '3. 建议要具体到可以直接执行，例如"给 X 发跟进邮件确认预算"，而不是"加强客户管理"。',
    '4. 如果数据为空，就把建议聚焦在"如何拿到第一批真实数据"，而不是假装有业务。',
    '5. kind 用于分类：revenue=直接挣钱，relationship=人际关系维护，risk=风险，ops=内部效率。',
    '',
    '严格输出以下 JSON（不要 markdown 代码块）：',
    '{',
    '  "headline": "一句话点破当前最关键的事",',
    '  "companyState": "两三句话描述公司现在的真实状态",',
    '  "marketScan": "市场/机会判断，晚上可以为 null",',
    '  "moves": [{"title":"","why":"","kind":"revenue","urgency":"today","suggestedAction":"","personaBasis":""}]',
    '}'
  ].join('\n');

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: '你是老板的数字自我 A-，负责经营这家一人公司。输出严格的原始 JSON。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });
    const raw = (response.content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw) as OpcAdvice;
    const moves = Array.isArray(parsed.moves) ? parsed.moves.slice(0, 6) : [];
    return {
      advice: {
        headline: parsed.headline || '经营扫描完成',
        companyState: parsed.companyState || '',
        marketScan: parsed.marketScan ?? null,
        moves
      },
      snapshot,
      persona,
      usedLlm: true
    };
  } catch {
    return { advice: fallbackAdvice(snapshot, mode), snapshot, persona, usedLlm: false };
  }
}

function fallbackAdvice(snapshot: OpcSnapshot, mode: 'morning' | 'evening'): OpcAdvice {
  const moves: OpcAdvice['moves'] = [];
  if (snapshot.crm.overdueFollowUps > 0) {
    moves.push({
      title: `处理 ${snapshot.crm.overdueFollowUps} 条逾期跟进`,
      why: '逾期跟进直接损耗成交概率和信任。',
      kind: 'relationship',
      urgency: 'now',
      suggestedAction: '逐条确认状态，发出下一步沟通。',
      personaBasis: '基础经营常识（人格未参与，模型不可用）'
    });
  }
  if (snapshot.approvals > 0) {
    moves.push({
      title: `清掉 ${snapshot.approvals} 个待审批`,
      why: '待审批会阻塞下游执行。',
      kind: 'ops',
      urgency: 'today',
      suggestedAction: '进入审批面板逐个拍板。',
      personaBasis: '基础经营常识（人格未参与，模型不可用）'
    });
  }
  if (!moves.length) {
    moves.push({
      title: snapshot.crm.hotLeads === 0 ? '录入第一批真实线索' : '推进现有机会',
      why: '当前系统里缺少可执行的经营信号。',
      kind: 'revenue',
      urgency: 'today',
      suggestedAction: snapshot.crm.hotLeads === 0 ? '在 CRM 录入真实客户线索。' : '挑一个开放机会推进到下一阶段。',
      personaBasis: '基础经营常识（人格未参与，模型不可用）'
    });
  }
  return {
    headline: mode === 'morning' ? '模型不可用，已按基础规则生成建议' : '模型不可用，已按基础规则生成复盘',
    companyState: `活跃任务 ${snapshot.tasks.active}，热线索 ${snapshot.crm.hotLeads}，净现金流 ${snapshot.finance.netCashflow}。`,
    marketScan: null,
    moves
  };
}

function renderAdvice(advice: OpcAdvice) {
  return advice.moves
    .map((m, i) => [
      `${i + 1}. [${m.kind}/${m.urgency}] ${m.title}`,
      `   为什么：${m.why}`,
      `   怎么做：${m.suggestedAction}`,
      `   人格依据：${m.personaBasis}`
    ].join('\n'))
    .join('\n\n');
}

export async function runASelfMorningScan(repos: Repositories, config: AppConfig) {
  const { advice, snapshot, persona, usedLlm } = await generateOpcAdvice(repos, config, 'morning');
  return repos.createASelfOpcRun({
    runType: 'morning',
    title: advice.headline,
    marketScan: advice.marketScan,
    companyState: advice.companyState,
    recommendations: renderAdvice(advice),
    metrics: {
      hotLeads: snapshot.crm.hotLeads,
      overdueFollowUps: snapshot.crm.overdueFollowUps,
      netCashflow: snapshot.finance.netCashflow,
      activeTasks: snapshot.tasks.active,
      pendingApprovals: snapshot.approvals,
      moveCount: advice.moves.length
    },
    status: 'ready',
    metadata: { source: 'a_self_engine', usedLlm, personaAvailable: Boolean(persona), moves: advice.moves }
  });
}

export async function runASelfEveningSummary(repos: Repositories, config: AppConfig) {
  const { advice, snapshot, persona, usedLlm } = await generateOpcAdvice(repos, config, 'evening');
  return repos.createASelfOpcRun({
    runType: 'evening',
    title: advice.headline,
    marketScan: advice.marketScan,
    companyState: advice.companyState,
    recommendations: renderAdvice(advice),
    metrics: {
      completedTasks: snapshot.tasks.done,
      activeTasks: snapshot.tasks.active,
      netCashflow: snapshot.finance.netCashflow,
      moveCount: advice.moves.length
    },
    status: 'ready',
    metadata: { source: 'a_self_engine', usedLlm, personaAvailable: Boolean(persona), moves: advice.moves }
  });
}

import type { Repositories } from '../db/repositories.js';
import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';

export type RelationshipPlay = {
  contactId: string;
  contactName: string;
  organization: string | null;
  relationshipState: string;
  risk: 'low' | 'medium' | 'high';
  intent: 'revive' | 'advance' | 'nurture' | 'close' | 'protect';
  reasoning: string;
  personaBasis: string;
  nextAction: string;
  channel: 'email' | 'telegram' | 'call' | 'meeting';
  draftMessage: string;
};

type PersonaBits = {
  displayName: string;
  mission: string;
  valuesOrder: string[];
  decisionPrinciples: string[];
  boundaries: string[];
  communicationStyle: Record<string, unknown>;
};

async function personaBits(repos: Repositories): Promise<PersonaBits | null> {
  const profile = await repos.getASelfProfile();
  if (!profile) return null;
  return {
    displayName: profile.display_name,
    mission: profile.mission,
    valuesOrder: toArray(profile.values_order),
    decisionPrinciples: toArray(profile.decision_principles),
    boundaries: toArray(profile.boundaries),
    communicationStyle: (profile.communication_style ?? {}) as Record<string, unknown>
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

function personaPrompt(persona: PersonaBits | null) {
  if (!persona) {
    return '数字人格尚未蒸馏。用克制、专业、不过度承诺的语气，并在 personaBasis 中说明人格缺失。';
  }
  return [
    `你就是 ${persona.displayName}，以第一人称替老板处理人际关系。`,
    `使命：${persona.mission}`,
    `价值排序：${persona.valuesOrder.join(' | ') || '未设定'}`,
    `决策原则：${persona.decisionPrinciples.join(' | ') || '未设定'}`,
    `绝不做：${persona.boundaries.join(' | ') || '未设定'}`,
    `沟通风格：${JSON.stringify(persona.communicationStyle)}`,
    'draftMessage 必须用上面的沟通风格写，读起来要像老板本人发的，不要像客服模板。'
  ].join('\n');
}

export async function planRelationshipMoves(
  repos: Repositories,
  config: AppConfig,
  limit = 6
): Promise<{ plays: RelationshipPlay[]; usedLlm: boolean; personaAvailable: boolean }> {
  const [persona, candidates] = await Promise.all([
    personaBits(repos),
    repos.listRelationshipCandidates(limit)
  ]);

  if (!candidates.length) {
    return { plays: [], usedLlm: false, personaAvailable: Boolean(persona) };
  }

  const provider = createModelProviderFromConfig(config);
  if (!provider) {
    return {
      plays: candidates.map((c: any) => fallbackPlay(c)),
      usedLlm: false,
      personaAvailable: Boolean(persona)
    };
  }

  const dossiers = await Promise.all(
    candidates.map((c: any) => repos.getRelationshipDossier(c.id).catch(() => null))
  );

  const contactBlocks = dossiers
    .filter(Boolean)
    .map((d: any) => ({
      contactId: d.contact.id,
      name: d.contact.name,
      organization: d.contact.organization_name ?? null,
      status: d.contact.status,
      notes: d.contact.notes,
      lastInteractionAt: d.contact.last_interaction_at,
      openFollowUps: d.followUps
        .filter((f: any) => f.status === 'open')
        .map((f: any) => ({ note: f.note, dueAt: f.due_at })),
      opportunities: d.opportunities.map((o: any) => ({
        title: o.title,
        stage: o.stage,
        amount: o.value_amount,
        currency: o.currency
      })),
      recentInteractions: d.interactions
        .slice(0, 5)
        .map((i: any) => ({ type: i.type, summary: i.summary, at: i.occurred_at }))
    }));

  const prompt = [
    personaPrompt(persona),
    '',
    '=== 需要你处理的人际关系（全部是真实数据）===',
    JSON.stringify(contactBlocks, null, 2),
    '',
    '为每个人给出一个具体的关系推进策略。要求：',
    '1. reasoning 必须引用上面的真实信息（逾期天数、机会阶段、上次互动时间等），不要编造。',
    '2. personaBasis 说明这个策略对应老板的哪条价值排序或决策原则。',
    '3. draftMessage 是可以直接发出去的完整消息正文，用老板的语气，不要写"尊敬的客户"这类模板话。',
    '4. 如果这个人已经很久没互动，intent 用 revive；如果机会在推进中，用 advance；如果有流失风险，用 protect。',
    '5. 绝不承诺价格、折扣、交付日期这类需要老板拍板的内容。',
    '',
    '严格输出原始 JSON 数组（不要 markdown 代码块）：',
    '[{"contactId":"","contactName":"","organization":null,"relationshipState":"","risk":"medium","intent":"advance","reasoning":"","personaBasis":"","nextAction":"","channel":"email","draftMessage":""}]'
  ].join('\n');

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: '你是老板的数字自我，负责维护人际关系。输出严格的原始 JSON 数组。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4
    });
    const raw = (response.content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw);
    const plays: RelationshipPlay[] = Array.isArray(parsed) ? parsed.slice(0, limit) : [];
    return { plays, usedLlm: true, personaAvailable: Boolean(persona) };
  } catch (err) {
    console.error('[a-self/relationship] llm failed:', err instanceof Error ? err.message : err);
    return {
      plays: candidates.map((c: any) => fallbackPlay(c)),
      usedLlm: false,
      personaAvailable: Boolean(persona)
    };
  }
}

function fallbackPlay(c: any): RelationshipPlay {
  const overdue = Number(c.overdue_count ?? 0);
  return {
    contactId: c.id,
    contactName: c.name,
    organization: c.organization_name ?? null,
    relationshipState: overdue > 0 ? `有 ${overdue} 条逾期跟进` : '关系正常',
    risk: overdue > 0 ? 'high' : 'low',
    intent: overdue > 0 ? 'protect' : 'nurture',
    reasoning: '模型不可用，按逾期跟进数量给出基础判断。',
    personaBasis: '人格未参与（模型不可用）',
    nextAction: overdue > 0 ? '立刻确认状态并给出下一步' : '保持定期联系',
    channel: 'email',
    draftMessage: ''
  };
}

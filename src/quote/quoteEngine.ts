import type { MemoryRecord } from '../types.js';

export interface PricingRule {
  serviceName: string;
  amount: number;
  currency: string;
  unit: string;
  notes: string;
  sourceText: string;
}

export interface QuoteDraft {
  workflow: 'quote';
  originalText: string;
  matchedRules: PricingRule[];
  pricingRuleCount: number;
  subtotal: number | null;
  currency: string;
  confidence: 'low' | 'medium' | 'high';
  assumptions: string[];
  riskNotes: string[];
  basis: string[];
  emailDraft: string;
  markdownArtifact: string;
  htmlArtifact: string;
}

export function parsePricingRules(text: string): PricingRule[] {
  const segments = text
    .split(/[\n；;。]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const rules: PricingRule[] = [];
  for (const segment of segments) {
    if (!/[¥￥$]|\b(?:RMB|CNY|USD)\b|人民币|美元|元/.test(segment)) continue;
    const amountMatch = segment.match(/([¥￥$]?\s*\d+(?:,\d{3})*(?:\.\d+)?\s*万?)(?:\s*(元|人民币|RMB|CNY|美元|USD))?(?:\s*[\/每]?\s*(月|年|次|小时|天|项目|人月|单|个|套|季度))?/i);
    if (!amountMatch) continue;

    const before = segment.slice(0, amountMatch.index).trim();
    const after = segment.slice((amountMatch.index ?? 0) + amountMatch[0].length).trim();
    const serviceName = cleanupServiceName(before);
    const amount = parseAmount(amountMatch[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    rules.push({
      serviceName,
      amount,
      currency: parseCurrency(segment, amountMatch[2]),
      unit: amountMatch[3] ?? inferUnit(segment),
      notes: cleanupNotes(after),
      sourceText: segment
    });
  }

  return dedupePricingRules(rules);
}

export function buildQuoteDraft(text: string, memories: MemoryRecord[]): QuoteDraft {
  const pricingRules = memories.flatMap((memory) => parsePricingRules(memory.content));
  const matchedRules = selectPricingRules(text, pricingRules);
  const currency = matchedRules[0]?.currency ?? pricingRules[0]?.currency ?? 'CNY';
  const subtotal = matchedRules.length ? matchedRules.reduce((sum, rule) => sum + rule.amount, 0) : null;
  const assumptions = [
    matchedRules.length
      ? '报价草案仅基于已导入的 pricing memory，正式合同、开票和付款需要单独确认。'
      : '没有命中可用价格规则，需要先通过 /import 导入价格表、服务包或报价规则。',
    '未导入折扣授权、合同条款或交付范围时，默认不承诺折扣、账期、排他条款或固定交付周期。',
    '报价邮件只生成草稿，不默认外发。'
  ];
  const riskNotes = buildRiskNotes(text, matchedRules, pricingRules.length);
  const basis = matchedRules.length
    ? matchedRules.map((rule) => `${rule.serviceName}：${formatMoney(rule.amount, rule.currency)} / ${rule.unit}${rule.notes ? `；${rule.notes}` : ''}`)
    : ['未命中 pricing memory。发送 `/import 价格表：网站维护套餐 3000 元/月；企业版 12000 元/年` 后再报价。'];
  const confidence: QuoteDraft['confidence'] = matchedRules.length
    ? pricingRules.length === matchedRules.length
      ? 'medium'
      : 'high'
    : 'low';
  const emailDraft = buildEmailDraft(text, matchedRules, subtotal, currency);
  const markdownArtifact = buildMarkdownArtifact(text, matchedRules, subtotal, currency, assumptions, riskNotes);

  return {
    workflow: 'quote',
    originalText: text,
    matchedRules,
    pricingRuleCount: pricingRules.length,
    subtotal,
    currency,
    confidence,
    assumptions,
    riskNotes,
    basis,
    emailDraft,
    markdownArtifact,
    htmlArtifact: markdownToSimpleHtml(markdownArtifact)
  };
}

export function renderImportedPricingRules(rules: PricingRule[]) {
  if (!rules.length) {
    return '没有解析到价格项。请使用类似 `/import 价格表：网站维护套餐 3000 元/月；企业版 12000 元/年` 的格式。';
  }

  return [
    `已导入报价规则：${rules.length} 条`,
    '',
    ...rules.map((rule, index) => `${index + 1}. ${rule.serviceName}：${formatMoney(rule.amount, rule.currency)} / ${rule.unit}${rule.notes ? `；${rule.notes}` : ''}`)
  ].join('\n');
}

export function renderQuoteDraft(draft: QuoteDraft) {
  return [
    'V3 Quote Agent 已生成报价草案。',
    '',
    `置信度：${draft.confidence}`,
    `报价规则数：${draft.pricingRuleCount}`,
    `命中规则数：${draft.matchedRules.length}`,
    `小计：${draft.subtotal === null ? '待定' : formatMoney(draft.subtotal, draft.currency)}`,
    '',
    '价格依据：',
    ...draft.basis.map((item) => `- ${item}`),
    '',
    '假设：',
    ...draft.assumptions.map((item) => `- ${item}`),
    '',
    '风险提示：',
    ...draft.riskNotes.map((item) => `- ${item}`),
    '',
    '邮件草稿：',
    draft.emailDraft,
    '',
    'Markdown 报价草案：',
    draft.markdownArtifact
  ].join('\n');
}

function selectPricingRules(text: string, rules: PricingRule[]) {
  const scored = rules
    .map((rule) => ({ rule, score: scoreRule(text, rule) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];
  const bestScore = scored[0].score;
  return scored.filter((item) => item.score === bestScore || item.score >= 3).map((item) => item.rule);
}

function scoreRule(text: string, rule: PricingRule) {
  const normalizedText = text.toLowerCase();
  const normalizedName = rule.serviceName.toLowerCase();
  let score = 0;
  if (normalizedText.includes(normalizedName) || normalizedName.includes(normalizedText)) score += 6;

  const tokens = normalizedName
    .split(/[^\p{Script=Han}a-z0-9]+/iu)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  for (const token of tokens) {
    if (normalizedText.includes(token)) score += token.length >= 4 ? 3 : 1;
  }

  for (const token of ['网站', '维护', '套餐', '企业版', '基础版', '顾问', '咨询', '自动化', '开发']) {
    if (normalizedName.includes(token) && normalizedText.includes(token)) score += 2;
  }

  return score;
}

function cleanupServiceName(value: string) {
  const cleaned = value
    .replace(/^(?:价格表|报价规则|服务包|套餐|导入|记住|请记住|[-*]\s*)[：:，,\s]*/i, '')
    .replace(/[：:，,\-—]+$/g, '')
    .trim();
  return cleaned || '未命名服务';
}

function cleanupNotes(value: string) {
  return value.replace(/^[，,。；;\s]+/, '').trim();
}

function parseAmount(value: string) {
  const hasWan = /万/.test(value);
  const numeric = Number(value.replace(/[¥￥$,\s万]/g, ''));
  return hasWan ? numeric * 10000 : numeric;
}

function parseCurrency(segment: string, explicitCurrency: string | undefined) {
  const currencyText = `${explicitCurrency ?? ''} ${segment}`;
  if (/\$|USD|美元/i.test(currencyText)) return 'USD';
  return 'CNY';
}

function inferUnit(segment: string) {
  if (/月|monthly/i.test(segment)) return '月';
  if (/年|annual|year/i.test(segment)) return '年';
  if (/小时|hour/i.test(segment)) return '小时';
  if (/人月/.test(segment)) return '人月';
  return '项目';
}

function buildRiskNotes(text: string, matchedRules: PricingRule[], pricingRuleCount: number) {
  const risks = [
    '当前是报价草案，不构成合同、发票或付款承诺。',
    '正式外发报价、开票、收款、退款、超折扣或特殊合同条款需要确认。'
  ];

  if (!pricingRuleCount) risks.unshift('没有导入价格表，无法生成可信标准报价。');
  if (!matchedRules.length && pricingRuleCount) risks.unshift('已有价格规则，但没有命中本次需求；需要补充服务范围或报价规则。');
  if (/折扣|优惠|减免|低价/i.test(text)) risks.push('用户请求涉及折扣，需要检查授权范围。');
  if (/合同|盖章|开票|发票|付款|账期|排他|赔偿/i.test(text)) risks.push('请求涉及合同、开票、付款或高风险条款，应升级确认。');
  return risks;
}

function buildEmailDraft(text: string, rules: PricingRule[], subtotal: number | null, currency: string) {
  if (!rules.length || subtotal === null) {
    return `你好，关于“${text}”，我先整理需求范围和报价规则。当前价格表里没有命中的标准服务项，我会补齐服务范围后再发正式报价草案。`;
  }

  const lines = rules.map((rule) => `- ${rule.serviceName}: ${formatMoney(rule.amount, rule.currency)} / ${rule.unit}`);
  return [
    '你好，',
    '',
    '根据目前确认的需求，我先整理一版报价草案供你参考：',
    ...lines,
    `小计：${formatMoney(subtotal, currency)}`,
    '',
    '以上为草案价格，最终范围、交付周期、合同条款和开票付款安排需要确认后再定稿。'
  ].join('\n');
}

function buildMarkdownArtifact(
  text: string,
  rules: PricingRule[],
  subtotal: number | null,
  currency: string,
  assumptions: string[],
  riskNotes: string[]
) {
  return [
    '# 报价草案',
    '',
    `需求：${text}`,
    '',
    '## 服务项',
    ...(rules.length
      ? rules.map((rule) => `- ${rule.serviceName}: ${formatMoney(rule.amount, rule.currency)} / ${rule.unit}${rule.notes ? ` (${rule.notes})` : ''}`)
      : ['- 待补充：未命中已导入价格规则']),
    '',
    `小计：${subtotal === null ? '待定' : formatMoney(subtotal, currency)}`,
    '',
    '## 假设',
    ...assumptions.map((item) => `- ${item}`),
    '',
    '## 风险提示',
    ...riskNotes.map((item) => `- ${item}`)
  ].join('\n');
}

function markdownToSimpleHtml(markdown: string) {
  const body = markdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith('- ')) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (!line.trim()) return '';
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join('\n');
  return `<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>报价草案</title></head>\n<body>\n${body}\n</body>\n</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dedupePricingRules(rules: PricingRule[]) {
  const seen = new Set<string>();
  const result: PricingRule[] = [];
  for (const rule of rules) {
    const key = `${rule.serviceName}:${rule.amount}:${rule.currency}:${rule.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rule);
  }
  return result;
}

function formatMoney(amount: number, currency: string) {
  const prefix = currency === 'USD' ? '$' : '¥';
  return `${prefix}${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

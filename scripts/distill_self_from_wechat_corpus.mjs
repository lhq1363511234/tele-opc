import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../dist/src/config/index.js';
import { pool } from '../dist/src/db/pool.js';
import { Repositories } from '../dist/src/db/repositories.js';
import { createModelProviderFromConfig } from '../dist/src/ai/modelProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CORPUS = path.resolve(process.cwd(), 'runtime/windows-xwechat-persona/persona-corpus.jsonl');
const DEFAULT_SUMMARY = path.resolve(process.cwd(), 'runtime/windows-xwechat-persona/persona-corpus-summary.json');
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'runtime/windows-xwechat-persona/distill');
const RUN_FAMILY = 'windows_xwechat_persona_v1';

const args = parseArgs(process.argv.slice(2));
const corpusPath = path.resolve(args.corpus ?? DEFAULT_CORPUS);
const summaryPath = path.resolve(args.summary ?? DEFAULT_SUMMARY);
const outDir = path.resolve(args.outDir ?? DEFAULT_OUT_DIR);
const apply = Boolean(args.apply);
const maxSelected = Number(args.maxSelected ?? 1200);
const maxChunks = Number(args.maxChunks ?? 14);
const maxCharsPerChunk = Number(args.maxCharsPerChunk ?? 12500);

fs.mkdirSync(outDir, { recursive: true });

const runId = `wechat_distill_${new Date().toISOString().replace(/[:.]/g, '-')}`;
const config = loadConfig();
const provider = createModelProviderFromConfig(config);
if (!provider) {
  throw new Error('AI provider is not configured; cannot distill corpus safely.');
}

const repos = new Repositories(pool);

const summary = readJsonIfExists(summaryPath);
const corpusStats = await collectCorpusStats(corpusPath);
const selected = await selectPersonaMessages(corpusPath, maxSelected);
const chunks = buildChunks(selected, maxChunks, maxCharsPerChunk);

const chunkSummaries = [];
for (let i = 0; i < chunks.length; i += 1) {
  const chunk = chunks[i];
  const chunkResult = await distillChunk(provider, chunk, i + 1, chunks.length);
  chunkSummaries.push({
    chunkIndex: i + 1,
    messageCount: chunk.items.length,
    years: sortedUnique(chunk.items.map((item) => item.year)),
    timeRange: {
      start: chunk.items[0]?.time ?? null,
      end: chunk.items.at(-1)?.time ?? null
    },
    summary: chunkResult
  });
  console.log(JSON.stringify({
    stage: 'chunk_distilled',
    chunk: i + 1,
    chunks: chunks.length,
    messageCount: chunk.items.length
  }));
}

const finalDistill = await synthesizeFinal(provider, {
  summary,
  corpusStats,
  selectedStats: summarizeSelected(selected),
  chunkSummaries: chunkSummaries.map((item) => ({
    chunkIndex: item.chunkIndex,
    messageCount: item.messageCount,
    years: item.years,
    timeRange: item.timeRange,
    summary: item.summary
  }))
});

const artifact = {
  runId,
  runFamily: RUN_FAMILY,
  createdAt: new Date().toISOString(),
  source: {
    corpusPath,
    summaryPath,
    sha256: sha256File(corpusPath)
  },
  stats: {
    corpusStats,
    selectedStats: summarizeSelected(selected),
    chunkCount: chunks.length
  },
  distillation: finalDistill,
  chunkSummaries
};

const artifactPath = path.join(outDir, `${runId}.json`);
fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(artifact, null, 2), 'utf8');

let dbResult = null;
if (apply) {
  dbResult = await applyDistillation(finalDistill, {
    runId,
    artifactPath,
    sourceSha256: artifact.source.sha256,
    corpusStats,
    selectedStats: summarizeSelected(selected)
  });
}

console.log(JSON.stringify({
  ok: true,
  applied: apply,
  artifactPath,
  stats: {
    totalRows: corpusStats.totalRows,
    selected: selected.length,
    chunks: chunks.length,
    selfTextKept: summary?.self_text_kept ?? null,
    keywordKept: summary?.keyword_kept ?? null
  },
  dbResult
}, null, 2));

await pool.end();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      out.apply = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function collectCorpusStats(file) {
  const byYear = {};
  const byType = {};
  let totalRows = 0;
  let keywordRows = 0;
  let groupRows = 0;
  let privateRows = 0;
  let minTime = null;
  let maxTime = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = safeJson(line);
    if (!obj) continue;
    totalRows += 1;
    const year = String(obj.time ?? '').slice(0, 4) || 'unknown';
    byYear[year] = (byYear[year] ?? 0) + 1;
    const type = String(obj.type ?? 'unknown');
    byType[type] = (byType[type] ?? 0) + 1;
    if (obj.keyword_hit) keywordRows += 1;
    if (obj.is_group) groupRows += 1;
    else privateRows += 1;
    if (typeof obj.time === 'string') {
      if (!minTime || obj.time < minTime) minTime = obj.time;
      if (!maxTime || obj.time > maxTime) maxTime = obj.time;
    }
  }
  return { totalRows, keywordRows, groupRows, privateRows, byYear, byType, minTime, maxTime };
}

async function selectPersonaMessages(file, limit) {
  const candidates = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = safeJson(line);
    if (!obj || typeof obj.text !== 'string') continue;
    const text = sanitizeText(obj.text);
    if (!text || text.length < 3) continue;
    const scored = {
      idHash: stableHash(String(obj.id ?? `${obj.timestamp ?? ''}:${text}`)),
      time: String(obj.time ?? ''),
      year: String(obj.time ?? '').slice(0, 4) || 'unknown',
      isGroup: Boolean(obj.is_group),
      type: obj.type ?? null,
      keywordHit: Boolean(obj.keyword_hit),
      text,
      score: 0
    };
    scored.score = scoreMessage(scored);
    if (scored.score < 4) continue;
    candidates.push(scored);
  }

  candidates.sort((a, b) => b.score - a.score || String(b.time).localeCompare(String(a.time)));

  const selected = [];
  const seen = new Set();
  for (const item of candidates) {
    const textHash = stableHash(item.text);
    if (seen.has(textHash)) continue;
    seen.add(textHash);
    selected.push(item);
    if (selected.length >= limit) break;
  }

  // 保证不是只看关键词：按年份补少量低噪声样本，避免把人格蒸馏成“搜索词画像”。
  const byYear = groupBy(candidates, (item) => item.year);
  for (const [year, items] of Object.entries(byYear)) {
    let added = 0;
    for (const item of items.sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
      if (selected.includes(item)) continue;
      const textHash = stableHash(item.text);
      if (seen.has(textHash)) continue;
      selected.push(item);
      seen.add(textHash);
      added += 1;
      if (added >= 30 || selected.length >= Math.floor(limit * 1.15)) break;
    }
  }

  return selected.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function sanitizeText(input) {
  return String(input)
    .replace(/https?:\/\/\\S+/gi, '[链接]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, '[邮箱]')
    .replace(/(?<!\\d)(?:\\+?86[-\\s]?)?1[3-9]\\d{9}(?!\\d)/g, '[手机号]')
    .replace(/\\bwxid_[a-z0-9_\\-]+\\b/gi, '[微信ID]')
    .replace(/\\b[A-Za-z0-9_-]{24,}\\b/g, '[长ID]')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 420);
}

function scoreMessage(item) {
  const text = item.text;
  let score = item.keywordHit ? 8 : 0;
  if (text.length >= 12) score += 2;
  if (text.length >= 40) score += 2;
  if (text.length >= 120) score += 1;
  if (!item.isGroup) score += 1;

  const groups = [
    ['我觉得', '我认为', '我希望', '我想', '我要', '我不', '别', '不要', '必须', '需要', '应该', '不能', '核心', '本质'],
    ['为什么', '原因', '复盘', '经验', '教训', '失败', '判断', '决定', '选择', '原则', '底层逻辑'],
    ['赚钱', '挣钱', '商业', '公司', '创业', '客户', '线索', '成交', '销售', '合作', '报价', '收款', '财务', '现金流', '项目'],
    ['AI', '人工智能', '模型', 'agent', 'Agent', '智能体', '自动化', '工具', '系统', '产品', '网站', '飞书', '微信'],
    ['人际', '朋友', '关系', '沟通', '回复', '信任', '信用', '承诺', '靠谱'],
    ['长期', '短期', '自由', '稳定', '复利', '机会', '市场', '赛道', '趋势', '极限', '全面']
  ];
  for (const group of groups) {
    const hits = group.filter((kw) => text.includes(kw)).length;
    score += Math.min(5, hits * 2);
  }
  if (/^[\\[<].{0,20}[\\]>]$/.test(text)) score -= 4;
  if (/^(收到|好的|OK|ok|嗯|啊|哈哈|是的|可以|行|好)$/i.test(text)) score -= 3;
  return score;
}

function buildChunks(items, maxChunkCount, charLimit) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  const maxItemsPerChunk = Math.ceil(items.length / Math.max(1, maxChunkCount));
  for (const item of items) {
    const lineLen = item.text.length + 80;
    if (current.length && (currentChars + lineLen > charLimit || current.length >= maxItemsPerChunk)) {
      chunks.push({ items: current });
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += lineLen;
  }
  if (current.length) chunks.push({ items: current });
  return chunks.slice(0, maxChunkCount);
}

async function distillChunk(provider, chunk, index, total) {
  const lines = chunk.items.map((item, n) => {
    const channel = item.isGroup ? '群聊' : '私聊';
    return `${n + 1}. ${item.time || item.year}｜${channel}｜${item.keywordHit ? '高信号' : '普通'}｜${item.text}`;
  }).join('\n');

  const prompt = [
    '你是“个人数字人格蒸馏”专家。下面是同一个用户自己发出的微信文本，已做隐私脱敏。',
    '任务：只提炼稳定人格/价值观/决策方式/经营偏好/沟通风格，不要复述任何原句，不要输出人名、手机号、微信号、公司名等隐私实体。',
    '如果证据不足，必须标记低置信度；不要编造。',
    '',
    `这是第 ${index}/${total} 个分块，共 ${chunk.items.length} 条。`,
    '=== 文本 ===',
    lines,
    '',
    '严格输出 JSON，不要 markdown：',
    JSON.stringify({
      observations: [
        {
          category: 'values|decision|business|communication|relationship|boundary|learning|identity',
          title: '不含隐私实体的短标题',
          summary: '一两句话概括稳定模式，不复述原文',
          why: '这个模式代表什么 Δ/动机/偏好',
          confidence: 0.7,
          tags: ['标签'],
          evidenceCount: 3,
          years: ['2026']
        }
      ],
      decision_patterns: [
        {
          question: '抽象决策问题',
          choice: '倾向选择',
          why: '为什么',
          future_rule: '以后遇到类似问题的规则',
          impact: 'low|medium|high|strategic',
          confidence: 0.7
        }
      ],
      communication_style: {
        prefer: [''],
        avoid: [''],
        tone: ['']
      },
      business_style: [''],
      relationship_style: [''],
      boundaries: [''],
      caveats: ['']
    })
  ].join('\n');

  return withJsonRetry(provider, [
    { role: 'system', content: '你只输出可解析 JSON。你必须保护隐私，不输出原始聊天句子。' },
    { role: 'user', content: prompt }
  ], `chunk_${index}`);
}

async function synthesizeFinal(provider, input) {
  const prompt = [
    '你是 Tele-OPC 的 A- 数字本人蒸馏器。你将看到微信语料分块的摘要，不是原始聊天。',
    '目标：为当前用户“罗德”生成一份可入库的人格画像、长期记忆、决策日志。它要服务于“经营公司挣钱 + 处理人际关系 + 通用工具执行”的愿景。',
    '',
    '硬性要求：',
    '1. 不输出任何聊天原文、人名、手机号、微信号、私人公司名等隐私实体。',
    '2. 结论必须来自分块摘要；证据弱就降低 confidence。',
    '3. 不要把人格写成死规则；表达成可迁移的偏好、判断原则和边界。',
    '4. 不要做鸡肋泛泛建议；要能指导数字本人接单、赚钱、沟通、拒绝、审批。',
    '5. 钱、签合同、股权、重大承诺必须保留人工审批边界。',
    '',
    '=== 统计 ===',
    JSON.stringify(input.summary ?? {}, null, 2),
    JSON.stringify(input.corpusStats, null, 2),
    JSON.stringify(input.selectedStats, null, 2),
    '',
    '=== 分块摘要 ===',
    JSON.stringify(input.chunkSummaries, null, 2),
    '',
    '严格输出 JSON，不要 markdown：',
    JSON.stringify({
      profile: {
        display_name: '罗德',
        mission: '一句话使命',
        profile_markdown: '一段画像：世界观、经营观、人际观、执行风格',
        values_order: ['A > B'],
        decision_principles: ['原则'],
        communication_style: { prefer: [''], avoid: [''], tone: [''] },
        boundaries: ['边界'],
        confidence: 0.7,
        caveats: ['不确定性']
      },
      memory_items: [
        {
          category: 'values|decision_style|business_style|communication_style|relationship_style|boundary|learning_pattern|identity',
          title: '[微信蒸馏] 短标题',
          content: '长期记忆摘要，不含隐私实体/原文',
          why: '为什么这条对数字本人有用',
          tags: ['标签'],
          confidence: 0.75
        }
      ],
      decision_logs: [
        {
          question: '以后遇到什么问题',
          choice: '倾向怎么选',
          why: '原因',
          future_rule: '可执行判断规则',
          impact: 'medium|high|strategic',
          confidence: 0.75
        }
      ]
    })
  ].join('\n');

  const parsed = await withJsonRetry(provider, [
    { role: 'system', content: '你只输出可解析 JSON；你是谨慎的隐私保护型人格蒸馏器。' },
    { role: 'user', content: prompt }
  ], 'final_synthesis');

  return normalizeFinal(parsed);
}

async function withJsonRetry(provider, messages, label) {
  let lastRaw = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await provider.chat({ messages, temperature: attempt === 1 ? 0.15 : 0.05 });
    lastRaw = response.content || '';
    const parsed = parseJsonLoose(lastRaw);
    if (parsed) return parsed;
    messages = [
      { role: 'system', content: '你是 JSON 修复器，只输出修复后的 raw JSON。' },
      {
        role: 'user',
        content: `下面模型输出不是合法 JSON。请在不增加事实的情况下修复为合法 JSON。标签：${label}\n\n${lastRaw.slice(0, 18000)}`
      }
    ];
  }
  throw new Error(`Model did not return valid JSON for ${label}: ${lastRaw.slice(0, 240)}`);
}

function parseJsonLoose(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeFinal(value) {
  const profile = isObject(value.profile) ? value.profile : {};
  const memoryItems = Array.isArray(value.memory_items) ? value.memory_items : [];
  const decisionLogs = Array.isArray(value.decision_logs) ? value.decision_logs : [];

  return {
    profile: {
      display_name: asString(profile.display_name) || '罗德',
      mission: asString(profile.mission) || '用数字本人配合工具经营公司、处理关系、沉淀判断。',
      profile_markdown: asString(profile.profile_markdown) || '',
      values_order: asStringArray(profile.values_order).slice(0, 10),
      decision_principles: asStringArray(profile.decision_principles).slice(0, 14),
      communication_style: isObject(profile.communication_style) ? profile.communication_style : {},
      boundaries: asStringArray(profile.boundaries).slice(0, 12),
      confidence: clampNumber(profile.confidence, 0.2, 0.95, 0.72),
      caveats: asStringArray(profile.caveats).slice(0, 8)
    },
    memory_items: memoryItems
      .filter(isObject)
      .map((item) => ({
        category: normalizeCategory(asString(item.category), 'learning_pattern'),
        title: ensureWechatTitle(asString(item.title) || '人格模式'),
        content: asString(item.content).slice(0, 900),
        why: asString(item.why).slice(0, 600),
        tags: asStringArray(item.tags).slice(0, 10),
        confidence: clampNumber(item.confidence, 0.2, 0.95, 0.65)
      }))
      .filter((item) => item.content.length >= 8)
      .slice(0, 18),
    decision_logs: decisionLogs
      .filter(isObject)
      .map((item) => ({
        question: asString(item.question).slice(0, 220),
        choice: asString(item.choice).slice(0, 500),
        why: asString(item.why).slice(0, 700),
        futureRule: asString(item.future_rule ?? item.futureRule).slice(0, 700),
        impact: ['low', 'medium', 'high', 'strategic'].includes(asString(item.impact)) ? asString(item.impact) : 'medium',
        confidence: clampNumber(item.confidence, 0.2, 0.95, 0.65)
      }))
      .filter((item) => item.question.length >= 6 && item.choice.length >= 4 && item.why.length >= 6)
      .slice(0, 12)
  };
}

async function applyDistillation(distill, context) {
  const profile = distill.profile;
  const updatedProfile = await repos.upsertASelfProfile({
    id: 'a_self_default',
    displayName: profile.display_name || '罗德',
    mission: profile.mission,
    profileMarkdown: profile.profile_markdown,
    valuesOrder: profile.values_order,
    decisionPrinciples: profile.decision_principles,
    communicationStyle: profile.communication_style,
    boundaries: profile.boundaries,
    confidence: profile.confidence,
    metadata: {
      source: RUN_FAMILY,
      runId: context.runId,
      artifactPath: context.artifactPath,
      sourceSha256: context.sourceSha256,
      corpusStats: context.corpusStats,
      selectedStats: context.selectedStats,
      caveats: profile.caveats,
      lastDistilledAt: new Date().toISOString()
    }
  });

  const memoryResults = [];
  for (const item of distill.memory_items) {
    memoryResults.push(await upsertMemory(item, context));
  }

  const decisionResults = [];
  for (const item of distill.decision_logs) {
    decisionResults.push(await upsertDecision(item, context));
  }

  return {
    profile: {
      id: updatedProfile.id,
      displayName: updatedProfile.display_name,
      confidence: Number(updatedProfile.confidence)
    },
    memoriesCreated: memoryResults.filter((r) => r.created).length,
    memoriesSkipped: memoryResults.filter((r) => r.skipped).length,
    decisionsCreated: decisionResults.filter((r) => r.created).length,
    decisionsSkipped: decisionResults.filter((r) => r.skipped).length
  };
}

async function upsertMemory(item, context) {
  const existing = await pool.query(
    `SELECT id FROM a_self_memory_items
     WHERE archived_at IS NULL AND source = $1 AND title = $2
     LIMIT 1`,
    [RUN_FAMILY, item.title]
  );
  if (existing.rows[0]?.id) return { skipped: true, id: existing.rows[0].id, title: item.title };
  const created = await repos.createASelfMemoryItem({
    category: item.category,
    title: item.title,
    content: item.content,
    why: item.why,
    tags: item.tags,
    source: RUN_FAMILY,
    sensitivity: 'private',
    confidence: item.confidence,
    metadata: {
      distillRunFamily: RUN_FAMILY,
      runId: context.runId,
      artifactPath: context.artifactPath,
      sourceSha256: context.sourceSha256,
      evidencePolicy: 'summary_only_no_raw_chat'
    }
  });
  return { created: true, id: created.id, title: created.title };
}

async function upsertDecision(item, context) {
  const existing = await pool.query(
    `SELECT id FROM a_self_decision_logs
     WHERE metadata->>'distillRunFamily' = $1 AND question = $2
     LIMIT 1`,
    [RUN_FAMILY, item.question]
  );
  if (existing.rows[0]?.id) return { skipped: true, id: existing.rows[0].id, question: item.question };
  const created = await repos.createASelfDecisionLog({
    question: item.question,
    choice: item.choice,
    why: item.why,
    futureRule: item.futureRule,
    impact: item.impact,
    metadata: {
      distillRunFamily: RUN_FAMILY,
      runId: context.runId,
      artifactPath: context.artifactPath,
      sourceSha256: context.sourceSha256,
      confidence: item.confidence,
      evidencePolicy: 'summary_only_no_raw_chat'
    }
  });
  return { created: true, id: created.id, question: created.question };
}

function summarizeSelected(items) {
  return {
    count: items.length,
    keyword: items.filter((item) => item.keywordHit).length,
    group: items.filter((item) => item.isGroup).length,
    private: items.filter((item) => !item.isGroup).length,
    byYear: groupCount(items, (item) => item.year),
    score: {
      min: Math.min(...items.map((item) => item.score)),
      max: Math.max(...items.map((item) => item.score)),
      avg: Number((items.reduce((sum, item) => sum + item.score, 0) / Math.max(1, items.length)).toFixed(2))
    }
  };
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = String(fn(item));
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
}

function groupCount(items, fn) {
  return items.reduce((acc, item) => {
    const key = String(fn(item));
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function sortedUnique(items) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function ensureWechatTitle(title) {
  const cleaned = title.replace(/^\\[微信蒸馏\\]\\s*/, '').trim().slice(0, 80);
  return `[微信蒸馏] ${cleaned || '人格模式'}`;
}

function normalizeCategory(value, fallback) {
  const allowed = new Set([
    'values',
    'decision_style',
    'business_style',
    'communication_style',
    'relationship_style',
    'boundary',
    'learning_pattern',
    'identity'
  ]);
  return allowed.has(value) ? value : fallback;
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

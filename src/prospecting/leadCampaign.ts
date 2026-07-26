import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { readPage, webSearch, type SearchHit } from './webSearch.js';
import type { DiscoveredLead } from './leadDiscovery.js';

export type CampaignProgress = {
  phase: 'planning' | 'searching' | 'reading' | 'extracting' | 'scoring' | 'pitching' | 'done';
  message: string;
  found: number;
  target: number;
};

export type CampaignLead = DiscoveredLead & {
  /** Personalised opening message for the specific offer. */
  outreach: string;
};

export type CampaignResult = {
  offer: string;
  icpSummary: string;
  queries: string[];
  sourcesRead: number;
  leads: CampaignLead[];
};

const BLOCKED_HOSTS = [
  'zhipin.com', 'liepin.com', 'zhaopin.com', '51job.com', 'lagou.com',
  'careerjet.cn', 'jobui.com', 'baidu.com', 'bing.com', 'google.com',
  'duckduckgo.com', 'wikipedia.org', 'zhihu.com', 'douban.com'
];

async function askJson<T>(config: AppConfig, system: string, prompt: string, temperature: number): Promise<T> {
  const provider = createModelProviderFromConfig(config);
  if (!provider) throw new Error('ai_provider_not_configured');

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await provider.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature
      });
      const raw = (response.content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(raw) as T;
    } catch (error) {
      lastError = error;
      // Gateway rate limits and truncated JSON are both transient here.
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('ask_json_failed');
}

/**
 * Turns "find 100 companies who might want AI bookkeeping" into a wide set of
 * search angles. One query only ever surfaces ~10 pages, so reaching 100 named
 * companies needs many differently-shaped queries.
 */
async function planCampaign(config: AppConfig, offer: string, icp: string, region: string, target: number) {
  const queryCount = Math.min(18, Math.max(6, Math.ceil(target / 5)));
  const prompt = [
    '我要大规模找潜在客户，需要你把目标客户描述拆成很多条不同角度的中文检索式。',
    '',
    `我卖的东西：${offer}`,
    `目标客户：${icp}`,
    region ? `地区限定：${region}` : '没有地区限定。',
    `我需要凑够 ${target} 家公司。`,
    '',
    '要求：',
    `1. 生成 ${queryCount} 条检索式，角度必须尽量分散，覆盖这几类：`,
    '   - 名录型：榜单、排行、协会会员名单、展商名录、产业园入驻企业（一页里有很多家公司，产出最高，至少占三分之二）',
    `   注意：不要搜到我的同行。我卖的是「${offer}」，卖同类东西的公司是竞争对手不是客户，检索式里不要出现能搜到他们的词。`,
    '   - 细分型：把目标客户按行业细分/业务模式/规模分别搜',
    '   - 地域型：如果有地区限定，拆成几个具体城市或区域分别搜',
    '   - 动态型：融资、扩产、新品、中标这类最近有动作的新闻',
    '2. 普通中文关键词组合，不要 site: 之类高级语法，不要出现"招聘"。',
    '2b. 名录型检索式必须带上能逼出"整页公司名"的词，例如：名单、完整名单、公司名称、排行榜、100强、TOP50、入围企业、公示名单。',
    '   反例（会搜到讲解性文章而不是名单）："专精特新企业榜单"、"中小企业协会会员名单"',
    '   正例："专精特新小巨人企业 完整名单 公司名称"、"2026 制造业民营企业100强 名单 排名"',
    '2c. 不要搜协会/政府机构本身的介绍页，要搜媒体或榜单站整理出来的企业清单页。',
    '3. icpSummary 一句话说清这类客户的共同特征和他们在这件事上的痛点。',
    '',
    '只输出 JSON：',
    '{"queries":[""],"icpSummary":""}'
  ].join('\n');

  const plan = await askJson<{ queries: string[]; icpSummary: string }>(
    config,
    '你是 B2B 线索挖掘专家。输出严格的原始 JSON。',
    prompt,
    0.4
  );
  const queries = Array.isArray(plan.queries)
    ? plan.queries.filter((q) => typeof q === 'string' && q.trim()).slice(0, queryCount)
    : [];
  return {
    queries: queries.length ? queries : [[region, icp].filter(Boolean).join(' ')],
    icpSummary: plan.icpSummary ?? ''
  };
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Normalises a company name so "深圳XX科技有限公司" and "XX科技" collapse together. */
const CITY_PREFIXES = /^(北京|上海|广州|深圳|杭州|南京|苏州|成都|重庆|武汉|西安|天津|长沙|郑州|青岛|大连|宁波|厦门|福州|合肥|济南|昆明|南昌|贵阳|株洲|无锡|东莞|佛山|珠海|中山|嘉兴|温州|绍兴|台州|常州|南通|徐州|烟台|潍坊|洛阳|石家庄|太原|哈尔滨|长春|沈阳|兰州|银川|西宁|乌鲁木齐|呼和浩特|南宁|海口|拉萨|香港|澳门|台湾)(市)?/;

function nameKey(name: string) {
  return name
    .replace(/[（(].*?[)）]/g, '')
    .replace(CITY_PREFIXES, '')
    .replace(/(股份)?有限(责任)?公司|集团|科技|信息|网络|数字|文化|传媒|咨询|服务|管理|中心|工作室/g, '')
    .replace(/[\s\-·、,，.。]/g, '')
    .toLowerCase();
}

type RawCandidate = { organizationName: string; evidence?: string; sourceIndex?: number };

async function extractFromBatch(config: AppConfig, corpus: string, errors: string[]): Promise<RawCandidate[]> {
  const prompt = [
    '下面是从公开搜索抓到的网页资料。请把资料中出现的**公司/品牌名**全部提取出来。',
    '',
    corpus,
    '',
    '规则：',
    '1. 两种来源都要提取：(a) 网页本身就是某家公司的官网；(b) 榜单、盘点、新闻正文里点名提到的公司。',
    '2. organizationName 必须一字不差地照抄资料原文，不要翻译、不要补全、不要编造。',
    '3. evidence 抄一句资料原文，说明这家公司是做什么的。',
    '4. sourceIndex 填这家公司来自第几条资料（方括号里的数字）。',
    '5. 媒体网站本身、政府部门、招聘平台不要提取；但它们文章里提到的公司要提取。',
    '6. 尽量多提，不要自己判断合不合适，筛选是下一步的事。',
    '7. 如果某一条资料是名单/榜单/名录，里面列出的每一家公司都要单独提取出来，一家都不要漏，这类资料是最有价值的。',
    '',
    '只输出 JSON 数组：',
    '[{"organizationName":"","evidence":"","sourceIndex":1}]'
  ].join('\n');
  try {
    const result = await askJson<RawCandidate[]>(
      config,
      '你是信息抽取引擎，只抄写原文中真实出现的内容。输出严格的原始 JSON 数组。',
      prompt,
      0.1
    );
    return Array.isArray(result) ? result : [];
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  }
}

type ScoredLead = Omit<CampaignLead, 'outreach'>;

async function scoreBatch(params: {
  config: AppConfig;
  offer: string;
  icp: string;
  region: string;
  voiceBlock: string;
  candidates: RawCandidate[];
  sourceUrls: Map<number, SearchHit>;
}): Promise<ScoredLead[]> {
  const { config, offer, icp, region, candidates, sourceUrls } = params;
  const prompt = [
    params.voiceBlock,
    '',
    '下面是候选公司清单。请判断哪些值得作为潜在客户去接触。',
    '',
    `我卖的东西：${offer}`,
    `我要找的客户：${icp}`,
    region ? `地区：${region}` : '',
    '',
    '候选清单：',
    candidates.map((item, i) => `${i + 1}. ${item.organizationName}｜${item.evidence ?? ''}`.slice(0, 260)).join('\n'),
    '',
    '来源对照（sourceIndex → 网址）：',
    [...sourceUrls.entries()].map(([i, hit]) => `${i} = ${hit.url}`).join('\n'),
    '',
    '要求：',
    '1. 清单里每一家都要给出判断，不要漏。',
    '2. score 是 0-100 匹配度：完全对口 75+；沾边值得试 45-70；地区或规模信息缺失不是扣分理由，写进 note 让我自己核实。',
    '2b. **同行直接剔除**：如果这家公司自己就在卖我要卖的东西（同类产品、同类服务、代理商、服务商），score 一律给 0-20，他们是竞争对手不是客户。',
    '   例：我卖 AI 财务，那么财税代账公司、财务咨询公司、会计师事务所都是同行，不是客户。',
    '2c. 媒体、榜单网站、行业协会、政府部门、平台本身也给 0-20，他们不是买家。',
    '3. scoreReason 必须引用候选清单里的具体信息。',
    '4. name 填应该找的角色（如"财务负责人"、"创始人"），除非清单里出现真实人名。绝不编造邮箱电话。',
    '5. buyingSignal 写这家公司为什么现在可能需要（从资料里找依据，没有就留空）。',
    '6. approach 写第一次接触的切入点，一句话，具体到这家公司在做什么。',
    '7. sourceUrl 从来源对照里抄对应网址。',
    '',
    '只输出 JSON 数组：',
    '[{"name":"","organizationName":"","website":"","region":"","businessLine":"","buyingSignal":"","score":70,"scoreReason":"","note":"","approach":"","sourceUrl":"","sourceTitle":""}]'
  ].filter(Boolean).join('\n');

  try {
    const leads = await askJson<ScoredLead[]>(
      config,
      '你是 B2B 线索分析师，基于给定材料判断，不编造材料以外的事实。输出严格的原始 JSON 数组。',
      prompt,
      0.2
    );
    return Array.isArray(leads)
      ? leads.filter((l) => l && typeof l.organizationName === 'string' && l.organizationName.trim())
      : [];
  } catch {
    return [];
  }
}

/** Writes the actual first-touch message for each company, in the owner's voice. */
async function writeOutreach(params: {
  config: AppConfig;
  offer: string;
  voiceBlock: string;
  leads: ScoredLead[];
}): Promise<Map<string, string>> {
  const { config, offer, leads } = params;
  const prompt = [
    params.voiceBlock,
    '',
    `我要挨个联系下面这些公司，问他们需不需要：${offer}`,
    '',
    '公司清单：',
    leads.map((l, i) => `${i + 1}. ${l.organizationName}｜${l.businessLine ?? ''}｜切入点：${l.approach ?? ''}`.slice(0, 240)).join('\n'),
    '',
    '要求：',
    '1. 每家写一条开场消息，60-110 字，中文。',
    '2. 必须提到这家公司自己在做的事，不能是可以群发的模板话术。',
    '3. 先说我注意到他们什么情况，再说我这边能解决什么，最后用一个低门槛的问题收尾（比如问他们现在怎么处理的）。',
    '4. 不要夸张、不要承诺效果、不要用"赋能/闭环/抓手"这类词，像正常人发消息。',
    '5. index 对应上面的序号。',
    '',
    '只输出 JSON 数组：',
    '[{"index":1,"message":""}]'
  ].join('\n');

  try {
    const result = await askJson<Array<{ index: number; message: string }>>(
      config,
      '你在替真人写第一次触达消息，语气克制自然。输出严格的原始 JSON 数组。',
      prompt,
      0.6
    );
    const map = new Map<string, string>();
    for (const item of Array.isArray(result) ? result : []) {
      const lead = leads[Number(item?.index) - 1];
      if (lead && typeof item?.message === 'string') map.set(lead.organizationName, item.message.trim());
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Runs tasks with bounded concurrency so the model gateway is not flooded. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs a full multi-query prospecting campaign. Designed for "find N companies"
 * where N is much larger than a single search can return.
 */
export async function runLeadCampaign(params: {
  config: AppConfig;
  offer: string;
  icp: string;
  region?: string;
  target: number;
  voiceBlock: string;
  onProgress?: (progress: CampaignProgress) => void | Promise<void>;
}): Promise<CampaignResult> {
  const { config, offer, icp, target, voiceBlock } = params;
  const region = params.region ?? '';
  const report = async (phase: CampaignProgress['phase'], message: string, found: number) => {
    await params.onProgress?.({ phase, message, found, target });
  };

  await report('planning', '正在把目标客户拆成多角度检索式…', 0);
  const plan = await planCampaign(config, offer, icp, region, target);

  await report('searching', `正在跑 ${plan.queries.length} 条检索式…`, 0);
  const hitsByHost = new Map<string, SearchHit>();
  for (const query of plan.queries) {
    const results = await webSearch(query, 10);
    for (const hit of results) {
      const host = safeHost(hit.url);
      if (!host || hitsByHost.has(hit.url)) continue;
      if (BLOCKED_HOSTS.some((blocked) => host.endsWith(blocked))) continue;
      hitsByHost.set(hit.url, hit);
    }
    if (hitsByHost.size >= target * 3) break;
  }

  const hits = [...hitsByHost.values()];
  if (!hits.length) {
    return { offer, icpSummary: plan.icpSummary, queries: plan.queries, sourcesRead: 0, leads: [] };
  }

  // Directory/listing pages carry many companies each, so read a wide slice.
  const readTarget = Math.min(hits.length, Math.max(24, Math.ceil(target * 0.8)));
  await report('reading', `找到 ${hits.length} 个来源，正在读取 ${readTarget} 个页面正文…`, 0);
  const pages = await mapPool(hits.slice(0, readTarget), 6, async (hit) => ({
    hit,
    body: await readPage(hit.url, 9000)
  }));

  const sourceUrls = new Map<number, SearchHit>();
  const documents: string[] = [];
  pages.forEach(({ hit, body }, index) => {
    sourceUrls.set(index + 1, hit);
    documents.push([
      `[${index + 1}] 标题：${hit.title}`,
      `网址：${hit.url}`,
      `摘要：${hit.snippet}`,
      body ? `页面正文：${body.replace(/\s+/g, ' ').slice(0, 6000)}` : ''
    ].filter(Boolean).join('\n'));
  });

  await report('extracting', `正在从 ${documents.length} 个页面里抽取公司名…`, 0);
  // Directory pages are long, so keep batches small enough to stay inside context.
  const batches = chunk(documents, 2);
  const extractionErrors: string[] = [];
  const extracted = await mapPool(batches, 3, (batch) =>
    extractFromBatch(config, batch.join('\n\n'), extractionErrors)
  );

  const deduped = new Map<string, RawCandidate>();
  for (const candidate of extracted.flat()) {
    const name = typeof candidate?.organizationName === 'string' ? candidate.organizationName.trim() : '';
    if (name.length < 2) continue;
    const key = nameKey(name);
    if (!key || deduped.has(key)) continue;
    deduped.set(key, { ...candidate, organizationName: name });
  }

  const candidates = [...deduped.values()].slice(0, Math.ceil(target * 3));
  if (!candidates.length) {
    if (extractionErrors.length) {
      throw new Error(`公司名抽取全部失败（${extractionErrors.length} 批）：${extractionErrors[0]}`);
    }
    return { offer, icpSummary: plan.icpSummary, queries: plan.queries, sourcesRead: hits.length, leads: [] };
  }

  await report('scoring', `抽出 ${candidates.length} 家候选，正在逐条对照画像打分…`, candidates.length);
  const scoreBatches = chunk(candidates, 25);
  const scored = (
    await mapPool(scoreBatches, 3, (batch) =>
      scoreBatch({ config, offer, icp, region, voiceBlock, candidates: batch, sourceUrls })
    )
  ).flat();

  const uniqueLeads = new Map<string, ScoredLead>();
  for (const lead of scored) {
    const key = nameKey(lead.organizationName);
    if (!key) continue;
    const existing = uniqueLeads.get(key);
    if (!existing || Number(lead.score ?? 0) > Number(existing.score ?? 0)) uniqueLeads.set(key, lead);
  }

  // Competitors and non-buyers are scored down hard above; never ship them as leads.
  const ranked = [...uniqueLeads.values()]
    .filter((lead) => Number(lead.score ?? 0) >= 40)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, target);

  await report('pitching', `正在为 ${ranked.length} 家公司写触达话术…`, ranked.length);
  const outreachBatches = chunk(ranked, 20);
  const outreachMaps = await mapPool(outreachBatches, 3, (batch) =>
    writeOutreach({ config, offer, voiceBlock, leads: batch })
  );
  const outreach = new Map<string, string>();
  for (const map of outreachMaps) for (const [key, value] of map) outreach.set(key, value);

  const leads: CampaignLead[] = ranked.map((lead) => ({
    ...lead,
    outreach: outreach.get(lead.organizationName) ?? lead.approach ?? ''
  }));

  await report('done', `完成，共产出 ${leads.length} 家可跟进公司。`, leads.length);

  return {
    offer,
    icpSummary: plan.icpSummary,
    queries: plan.queries,
    sourcesRead: hits.length,
    leads
  };
}

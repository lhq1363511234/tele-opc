import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { readPage, webSearch, type SearchHit } from './webSearch.js';

export type MarketScanProgress = {
  phase: 'planning' | 'searching' | 'reading' | 'extracting' | 'scoring' | 'done';
  message: string;
  found: number;
};

/** One concrete way to make money, grounded in what the scan actually read. */
export type MarketOpportunity = {
  /** Short name of the money-making motion, e.g. "小红书代运营的AI选题包". */
  name: string;
  /** Which market/vertical this sits in. */
  market: string;
  /** Who pays, specifically. */
  buyer: string;
  /** What is actually sold and delivered. */
  offer: string;
  /** Realistic price point in CNY. */
  pricePoint: string;
  /** How fast the first payment can realistically land. */
  daysToFirstCash: number;
  /** 0-100: how quickly this converts effort into received cash. */
  speedScore: number;
  /** 0-100: how well this fits the operator's existing assets and skills. */
  fitScore: number;
  /** 0-100: how much real demand evidence the scan found. */
  evidenceScore: number;
  /** Combined ranking score. */
  totalScore: number;
  /** What the scan actually saw that proves demand exists right now. */
  demandEvidence: string;
  /** Who else is already selling this and at what price. */
  competition: string;
  /** The single first action to take today. */
  firstMove: string;
  /** Why this could fail. */
  risk: string;
  /** Source URLs backing the evidence. */
  sources: string[];
};

export type MarketScanResult = {
  goal: string;
  queries: string[];
  sourcesRead: number;
  opportunities: MarketOpportunity[];
  /** Narrative read of where money is moving right now. */
  marketRead: string;
};

const BLOCKED_HOSTS = [
  'baidu.com', 'bing.com', 'google.com', 'duckduckgo.com', 'wikipedia.org'
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
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('ask_json_failed');
}

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

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Builds search angles that surface where money is actually moving, rather than
 * generic trend commentary. The queries deliberately mix demand-side signals
 * ("求推荐 多少钱"), supply-side pricing ("接单 报价"), and freshness markers so
 * the scan reads live marketplace behaviour instead of think-pieces.
 */
async function planScan(config: AppConfig, goal: string, assets: string): Promise<string[]> {
  const plan = await askJson<{ queries?: string[] }>(
    config,
    '你是市场机会侦察员。只输出 JSON。',
    [
      '我要找的是：现在就能快速收到钱的生意方向。',
      '',
      `我的目标：${goal}`,
      `我手上已有的资产和能力：${assets}`,
      '',
      '请生成中文检索式，用来在公开网络上找到"现在有人正在花钱买什么"的真实证据。',
      '',
      '好的检索式特征（必须模仿）：',
      '- 找需求方在喊的：「求推荐 多少钱」「有没有人做 帮忙」「急招 兼职 报价」',
      '- 找供给方在报价的：「接单 价格」「代做 收费标准」「服务报价 2026」',
      '- 找平台真实成交的：「闲鱼 卖爆」「小红书 接单」「淘宝 销量 服务」',
      '- 找新出现的缺口：「2026 新政策 企业 必须」「刚需 但没人做」',
      '',
      '坏的检索式（禁止）：',
      '- 「未来趋势分析」「行业研究报告」「前景展望」这类只会搜到评论文章，看不到真实成交',
      '',
      '生成 14 条，覆盖不同赛道和不同角度，不要都挤在一个行业。',
      '',
      '只输出 JSON：{"queries":["",""]}'
    ].join('\n'),
    0.5
  );
  const queries = (plan.queries ?? []).map((q) => String(q).trim()).filter(Boolean);
  return queries.slice(0, 16);
}

/** Pulls concrete money-making signals out of one page of raw text. */
async function extractSignals(config: AppConfig, body: string, url: string): Promise<string[]> {
  if (body.length < 200) return [];
  try {
    const result = await askJson<{ signals?: string[] }>(
      config,
      '你是商业信号抽取器。只输出 JSON。',
      [
        '从下面这段网页正文里，抽取"有人正在为什么付钱"的具体信号。',
        '',
        '每条信号必须包含：什么服务/产品、谁在买、价格大概多少（如果正文有）。',
        '正文里没有真实交易或报价信息，就返回空数组，不要编造。',
        '',
        `来源：${url}`,
        '正文：',
        body.slice(0, 6000),
        '',
        '只输出 JSON：{"signals":["某某服务，中小企业在买，报价300-800元",""]}'
      ].join('\n'),
      0.2
    );
    return (result.signals ?? []).map((s) => String(s).trim()).filter((s) => s.length > 8).slice(0, 6);
  } catch {
    return [];
  }
}

/**
 * Scans the open web for markets where money is moving right now, then ranks
 * them by how fast they convert into received cash given the operator's actual
 * assets. This is the capability that lets the persona answer "哪个赛道现在
 * 挣钱快" instead of only grinding through existing CRM leads.
 */
export async function runMarketScan(params: {
  config: AppConfig;
  goal: string;
  assets: string;
  voiceBlock: string;
  onProgress?: (progress: MarketScanProgress) => void | Promise<void>;
}): Promise<MarketScanResult> {
  const { config, goal, assets, voiceBlock } = params;
  const report = async (phase: MarketScanProgress['phase'], message: string, found: number) => {
    await params.onProgress?.({ phase, message, found });
  };

  await report('planning', '正在把目标拆成市场侦察检索式…', 0);
  const queries = await planScan(config, goal, assets);

  await report('searching', `正在跑 ${queries.length} 条检索式…`, 0);
  const hitsByUrl = new Map<string, SearchHit>();
  for (const query of queries) {
    const results = await webSearch(query, 10).catch(() => [] as SearchHit[]);
    for (const hit of results) {
      const host = safeHost(hit.url);
      if (!host || BLOCKED_HOSTS.some((blocked) => host.endsWith(blocked))) continue;
      if (!hitsByUrl.has(hit.url)) hitsByUrl.set(hit.url, hit);
    }
  }

  const hits = [...hitsByUrl.values()].slice(0, 60);
  await report('reading', `正在读取 ${hits.length} 个来源正文…`, 0);
  const pages = await mapPool(hits, 6, async (hit) => ({
    hit,
    body: await readPage(hit.url, 9000).catch(() => '')
  }));
  const readPages = pages.filter((page) => page.body.length >= 200);

  await report('extracting', '正在抽取真实成交与报价信号…', 0);
  const signalGroups = await mapPool(readPages, 3, async (page) => ({
    url: page.hit.url,
    title: page.hit.title,
    signals: await extractSignals(config, page.body, page.hit.url)
  }));
  const evidence = signalGroups.filter((group) => group.signals.length > 0);

  if (evidence.length === 0) {
    return {
      goal,
      queries,
      sourcesRead: readPages.length,
      opportunities: [],
      marketRead: '这轮公开检索没有读到足够的真实成交或报价信号，无法给出可信判断。建议把目标写得更具体后重试。'
    };
  }

  await report('scoring', `正在基于 ${evidence.length} 组信号排序赛道…`, evidence.length);
  const ranked = await askJson<{ marketRead?: string; opportunities?: MarketOpportunity[] }>(
    config,
    '你是经营判断引擎。只输出 JSON，不要输出 Markdown。',
    [
      voiceBlock,
      '',
      '下面是刚从公开网络读到的真实市场信号。基于这些信号判断：现在哪个方向最快能收到钱。',
      '',
      `目标：${goal}`,
      `我手上已有的资产和能力：${assets}`,
      '',
      '真实信号（每条都带来源）：',
      ...evidence.slice(0, 40).map((group) =>
        [`【${group.title || group.url}】`, ...group.signals.map((s) => `- ${s}`), `来源：${group.url}`].join('\n')
      ),
      '',
      '判断规则（严格执行）：',
      '- 只能基于上面读到的信号判断，不许凭常识补充没读到的市场',
      '- daysToFirstCash 是从今天开始到第一笔钱到账的天数，要按最保守的估计填',
      '- speedScore 高 = 客单价低、决策链短、不需要资质、当天能交付',
      '- fitScore 高 = 用我已有的资产和能力就能做，不需要重新学或重新建',
      '- evidenceScore 高 = 上面的信号里能直接看到有人付钱和具体价格',
      '- totalScore = speedScore*0.4 + fitScore*0.35 + evidenceScore*0.25',
      '- firstMove 必须是今天就能做完的一个具体动作，不能写"调研""准备"这类虚动作',
      '- 需要资质、需要囤货、需要平台审核超过一周的方向，speedScore 必须压到 30 以下',
      '- 给出 5 个方向，按 totalScore 从高到低排',
      '',
      '只输出 JSON：',
      '{"marketRead":"两三句话说清楚钱现在往哪流","opportunities":[{"name":"","market":"","buyer":"","offer":"","pricePoint":"","daysToFirstCash":1,"speedScore":80,"fitScore":70,"evidenceScore":60,"totalScore":72,"demandEvidence":"","competition":"","firstMove":"","risk":"","sources":[""]}]}'
    ].join('\n'),
    0.4
  );

  const opportunities = (ranked.opportunities ?? [])
    .filter((item) => item && typeof item.name === 'string' && item.name.trim().length > 0)
    .map((item) => ({
      ...item,
      speedScore: Number(item.speedScore ?? 0),
      fitScore: Number(item.fitScore ?? 0),
      evidenceScore: Number(item.evidenceScore ?? 0),
      totalScore: Number(item.totalScore ?? 0),
      daysToFirstCash: Number(item.daysToFirstCash ?? 0),
      sources: Array.isArray(item.sources) ? item.sources.filter((s): s is string => typeof s === 'string') : []
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

  await report('done', '市场扫描完成', opportunities.length);

  return {
    goal,
    queries,
    sourcesRead: readPages.length,
    opportunities,
    marketRead: ranked.marketRead ?? ''
  };
}

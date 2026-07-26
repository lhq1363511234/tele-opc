import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { webSearch, readPage, type SearchHit } from './webSearch.js';

export type DiscoveredLead = {
  name: string;
  organizationName: string;
  website?: string;
  region?: string;
  businessLine?: string;
  buyingSignal?: string;
  score: number;
  scoreReason: string;
  note: string;
  approach?: string;
  sourceUrl: string;
  sourceTitle: string;
};

export type DiscoveryPlan = {
  queries: string[];
  icpSummary: string;
  disqualifiers: string[];
};

async function askJson<T>(config: AppConfig, system: string, prompt: string, temperature: number): Promise<T> {
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

export async function planDiscovery(config: AppConfig, icp: string, region: string): Promise<DiscoveryPlan> {
  const prompt = [
    '我要找新客户。请把下面这段目标客户描述，转成可以直接用于搜索引擎的中文检索式。',
    '',
    `目标客户：${icp}`,
    region ? `地区限定：${region}` : '没有地区限定。',
    '',
    '要求：',
    '1. 生成 3-4 条检索式，彼此角度不同：',
    '   - 官网型：能直接搜到这类公司自己的官网（关键词要像公司自我介绍会用的词）',
    '   - 名录型：能搜到榜单、名单、排行、协会会员、展商名录这类"一页里有很多家公司"的页面',
    '   - 动态型：能搜到融资、扩产、新品发布、招标这类说明他们最近有动作的新闻',
    '2. 每条检索式是普通中文关键词组合，不要用 site: 这类高级语法；不要出现"招聘"两个字，招聘网站没有价值。',
    '3. icpSummary 用一句话说清这类客户的共同特征和他们可能的痛点。',
    '4. disqualifiers 列出应该排除的对象（比如同行、太大的公司、明显不匹配的类型）。',
    '',
    '只输出 JSON：',
    '{"queries":[""],"icpSummary":"","disqualifiers":[""]}'
  ].join('\n');

  const plan = await askJson<DiscoveryPlan>(config, '你是 B2B 线索挖掘专家。输出严格的原始 JSON。', prompt, 0.3);
  return {
    queries: Array.isArray(plan.queries) ? plan.queries.filter((q) => typeof q === 'string' && q.trim()).slice(0, 4) : [],
    icpSummary: plan.icpSummary ?? '',
    disqualifiers: Array.isArray(plan.disqualifiers) ? plan.disqualifiers.slice(0, 6) : []
  };
}

export async function discoverLeads(params: {
  config: AppConfig;
  icp: string;
  region: string;
  limit: number;
  voiceBlock: string;
  deepRead?: boolean;
}): Promise<{ plan: DiscoveryPlan; leads: DiscoveredLead[]; searched: number }> {
  const { config, icp, region, limit } = params;
  const plan = await planDiscovery(config, icp, region);
  if (!plan.queries.length) plan.queries = [[region, icp].filter(Boolean).join(' ')];

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const query of plan.queries) {
    const results = await webSearch(query, 8);
    for (const hit of results) {
      const host = safeHost(hit.url);
      if (!host || seen.has(host)) continue;
      if (BLOCKED_HOSTS.some((blocked) => host.endsWith(blocked))) continue;
      seen.add(host);
      hits.push(hit);
    }
  }

  if (!hits.length) return { plan, leads: [], searched: 0 };

  const shortlist = hits.slice(0, 12);
  const readCount = params.deepRead ? 10 : 6;
  const enriched = await Promise.all(
    shortlist.map(async (hit, index) => ({
      hit,
      page: index < readCount ? (await readPage(hit.url, 3000)).slice(0, 3000) : ''
    }))
  );

  const corpus = enriched
    .map(({ hit, page }, index) =>
      [
        `[${index + 1}] 标题：${hit.title}`,
        `网址：${hit.url}`,
        `摘要：${hit.snippet}`,
        page ? `页面正文节选：${page.replace(/\s+/g, ' ').slice(0, 1500)}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');

  // Stage 1 — pull every company name that actually appears in the material.
  const extractPrompt = [
    '下面是从公开搜索抓到的网页资料。请把资料中出现的**公司/品牌名**全部提取出来。',
    '',
    corpus,
    '',
    '规则：',
    '1. 两种来源都要提取：(a) 网页本身就是某家公司的官网；(b) 榜单、盘点、新闻正文里点名提到的公司。',
    '2. organizationName 必须一字不差地照抄资料原文，不要翻译、不要补全、不要编造。',
    '3. evidence 抄一句资料原文，说明这家公司是做什么的。',
    '4. sourceIndex 填这家公司来自第几条资料（上面方括号里的数字）。',
    '5. 媒体网站本身（搜狐、知乎、网易）、政府部门、招聘平台不要提取；但它们文章里提到的公司要提取。',
    '6. 尽量多提，不要自己判断合不合适，筛选是下一步的事。',
    '',
    '只输出 JSON 数组：',
    '[{"organizationName":"","evidence":"","sourceIndex":1}]'
  ].join('\n');

  type RawCandidate = { organizationName: string; evidence?: string; sourceIndex?: number };
  const rawCandidates = await askJson<RawCandidate[]>(
    config,
    '你是信息抽取引擎，只抄写原文中真实出现的内容。输出严格的原始 JSON 数组。',
    extractPrompt,
    0.1
  );

  const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .filter((item) => item && typeof item.organizationName === 'string' && item.organizationName.trim().length >= 2)
    .slice(0, 45);
  if (!candidates.length) return { plan, leads: [], searched: hits.length };

  // Stage 2 — score them against the ICP in the owner's voice.
  const scorePrompt = [
    params.voiceBlock,
    '',
    '下面是候选公司清单。请判断哪些值得作为潜在客户去跟进。',
    '',
    `我要找的客户：${icp}`,
    region ? `地区：${region}` : '',
    plan.disqualifiers.length ? `倾向排除：${plan.disqualifiers.join('、')}` : '',
    '',
    '候选清单：',
    candidates
      .map((item, index) => `${index + 1}. ${item.organizationName}｜${item.evidence ?? ''}`.slice(0, 300))
      .join('\n'),
    '',
    '来源对照（sourceIndex → 网址）：',
    enriched.map(({ hit }, index) => `${index + 1} = ${hit.url}`).join('\n'),
    '',
    '要求：',
    `1. 返回 ${limit} 条，按匹配度从高到低。同一家公司只出现一次。清单里够数就必须返回满 ${limit} 条。`,
    '2. score 是 0-100 匹配度。完全对口给 75 以上；沾边但值得试的给 45-70；只有明显不可能合作的才剔除。',
    '2b. 地区信息缺失不是剔除理由，标注在 note 里让我自己核实即可。',
    '3. scoreReason 必须引用候选清单里的具体信息，说明为什么给这个分。',
    '4. name 填应该找的角色（如"市场负责人"、"电商运营总监"），除非清单里出现了真实人名。绝不编造邮箱电话。',
    '5. approach 写第一次接触的切入点，一句话，要具体到这家公司在做什么。',
    '6. sourceUrl 从上面的来源对照里抄对应网址。',
    '',
    '只输出 JSON 数组：',
    '[{"name":"","organizationName":"","website":"","region":"","businessLine":"","buyingSignal":"","score":70,"scoreReason":"","note":"","approach":"","sourceUrl":"","sourceTitle":""}]'
  ]
    .filter(Boolean)
    .join('\n');

  const leads = await askJson<DiscoveredLead[]>(
    config,
    '你是 B2B 线索分析师，基于给定材料判断，不编造材料以外的事实。输出严格的原始 JSON 数组。',
    scorePrompt,
    0.2
  );

  const list = Array.isArray(leads)
    ? leads
        .filter((lead) => lead && typeof lead.organizationName === 'string' && lead.organizationName.trim())
        .slice(0, limit)
    : [];

  return { plan, leads: list, searched: hits.length };
}

const BLOCKED_HOSTS = [
  'zhipin.com',
  'liepin.com',
  'zhaopin.com',
  '51job.com',
  'lagou.com',
  'careerjet.cn',
  'jobui.com',
  'baidu.com',
  'bing.com',
  'google.com'
];

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

import type { ProspectingDraft, ProspectingLeadCandidate } from './prospectingEngine.js';

export interface ProspectingSourceConnector {
  findCandidates(draft: ProspectingDraft, options?: { limit?: number }): Promise<ProspectingLeadCandidate[]>;
}

export interface PublicSourceConfig {
  name: string;
  url: string;
  sourceType: 'search' | 'directory' | 'map' | 'jobs' | 'company_registry' | 'news';
}

export class PublicSourceProspectingConnector implements ProspectingSourceConnector {
  constructor(private readonly sources: PublicSourceConfig[] = publicSourcesFromEnv()) {}

  async findCandidates(draft: ProspectingDraft, options: { limit?: number } = {}) {
    const limit = Math.max(1, Math.min(options.limit ?? 6, 20));
    if (!this.sources.length) return [];

    const candidates: ProspectingLeadCandidate[] = [];
    for (const source of this.sources.slice(0, 5)) {
      if (candidates.length >= limit) break;
      const fetched = await fetchPublicSource(source);
      if (!fetched) continue;

      const names = extractCandidateNames(fetched.html, draft).slice(0, limit - candidates.length);
      const contactSignals = extractContactSignals(fetched.html, source.url);
      for (const [index, name] of names.entries()) {
        candidates.push(buildPublicSourceCandidate({
          draft,
          source,
          name,
          title: fetched.title,
          contactSignals,
          index
        }));
      }
    }

    return candidates.slice(0, limit);
  }
}

export function publicSourcesFromEnv(value = process.env.PROSPECTING_PUBLIC_SOURCE_URLS): PublicSourceConfig[] {
  if (!value?.trim()) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const parts = entry.split('|').map((part) => part.trim()).filter(Boolean);
      const [nameOrUrl, maybeUrl, maybeType] = parts;
      const url = maybeUrl ?? nameOrUrl;
      return {
        name: maybeUrl ? nameOrUrl : `公开来源 ${index + 1}`,
        url,
        sourceType: parseSourceType(maybeType, url)
      };
    })
    .filter((source) => isHttpUrl(source.url));
}

async function fetchPublicSource(source: PublicSourceConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Tele-OPC-OS/0.1 public-source-research (+https://github.com/tele-opc)'
      }
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/html|text|xml|json/i.test(contentType)) return null;

    const html = (await response.text()).slice(0, 1_500_000);
    return {
      html,
      title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? source.name
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractCandidateNames(html: string, draft: ProspectingDraft) {
  const textBlocks = [
    ...matchAll(html, /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi),
    ...matchAll(html, /<a\b[^>]*>([\s\S]*?)<\/a>/gi),
    ...matchAll(html, /"name"\s*:\s*"([^"]{2,80})"/gi)
  ];
  const fallbackTitle = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (fallbackTitle) textBlocks.unshift(fallbackTitle);

  const segmentTokens = draft.icp.segment
    .split(/[\/\s,，、|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const names = textBlocks
    .map(cleanText)
    .flatMap(splitCandidateText)
    .map((item) => item.trim())
    .filter((item) => looksLikeOrganizationName(item, draft.icp.region, segmentTokens));

  return [...new Set(names)].slice(0, 20);
}

function buildPublicSourceCandidate(params: {
  draft: ProspectingDraft;
  source: PublicSourceConfig;
  name: string;
  title: string;
  contactSignals: ReturnType<typeof extractContactSignals>;
  index: number;
}): ProspectingLeadCandidate {
  const { draft, source, name, title, contactSignals, index } = params;
  const score = {
    fit_score: 24,
    intent_score: source.sourceType === 'jobs' ? 22 : 17,
    accessibility_score: source.sourceType === 'directory' || source.sourceType === 'company_registry' ? 13 : 10,
    value_score: 11,
    risk_score: 8,
    confidence_score: 4
  };
  const totalScore = Object.values(score).reduce((sum, value) => sum + value, 0);

  return {
    name,
    source: source.name,
    query: source.url,
    score,
    totalScore,
    priority: totalScore >= 78 ? 'A' : totalScore >= 64 ? 'B' : 'C',
    reasons: [
      `公开来源命中：${source.name}`,
      `符合 ICP 地域/领域假设：${draft.icp.region} / ${draft.icp.segment}`,
      source.sourceType === 'jobs' ? '招聘/岗位来源可能代表扩张或预算信号。' : '目录/公开页面可作为候选账户池证据。',
      '仍需人工复核官网、联系方式和是否适合触达。'
    ],
    enrichmentFields: {
      region: draft.icp.region,
      segment: draft.icp.segment,
      observedName: name,
      sourceType: source.sourceType,
      sourceUrl: source.url,
      sourceTitle: cleanText(title),
      publicEmail: contactSignals.emails[0],
      publicPhone: contactSignals.phones[0],
      contactUrl: contactSignals.contactUrls[0],
      evidenceStatus: 'public_source_observed'
    },
    sources: [
      {
        type: source.sourceType,
        name: source.name,
        url: source.url,
        title: cleanText(title),
        observedName: name,
        email: contactSignals.emails[0],
        phone: contactSignals.phones[0],
        contactUrl: contactSignals.contactUrls[0],
        evidenceStatus: 'observed'
      }
    ],
    metadata: {
      workflow: 'prospecting',
      source: 'public_source_connector_v1',
      connector: 'public_source',
      sourceType: source.sourceType,
      sourceUrl: source.url,
      sourceTitle: cleanText(title),
      evidenceStatus: 'public_source_observed',
      requiresPublicVerification: true,
      originalText: draft.originalText,
      selectedSkillIds: draft.selectedSkillIds,
      rankInSource: index + 1
    }
  };
}

function extractContactSignals(html: string, baseUrl: string) {
  const emails = [...new Set(matchAll(html, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi))]
    .map((email) => email.toLowerCase())
    .slice(0, 5);
  const phones = [...new Set(matchAll(html, /(?:\+?86[-\s]?)?(?:1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/g))]
    .slice(0, 5);
  const contactUrls = [...new Set(
    [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .filter((match) => /联系|contact|邮箱|电话|合作/i.test(cleanText(match[2] ?? '')))
      .map((match) => toAbsoluteUrl(match[1] ?? '', baseUrl))
      .filter((url): url is string => Boolean(url))
  )].slice(0, 5);

  return {
    emails,
    phones,
    contactUrls
  };
}

function parseSourceType(value: string | undefined, url: string): PublicSourceConfig['sourceType'] {
  if (value && ['search', 'directory', 'map', 'jobs', 'company_registry', 'news'].includes(value)) {
    return value as PublicSourceConfig['sourceType'];
  }
  if (/job|zhaopin|liepin|boss|career|recruit/i.test(url)) return 'jobs';
  if (/map|poi|place/i.test(url)) return 'map';
  if (/news|公告|资讯/i.test(url)) return 'news';
  if (/registry|credit|工商|企业/i.test(url)) return 'company_registry';
  return 'directory';
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toAbsoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function looksLikeOrganizationName(value: string, region: string, segmentTokens: string[]) {
  if (value.length < 2 || value.length > 80) return false;
  if (/登录|注册|首页|更多|搜索|联系我们|隐私|条款|导航|菜单|copyright/i.test(value)) return false;
  if (/公司|集团|科技|有限|中心|餐饮|服务|贸易|网络|信息|智能|医疗|教育|物流|Inc\.?|Ltd\.?|LLC/i.test(value)) {
    return true;
  }
  if (region !== '目标地区待确认' && value.includes(region)) return true;
  return segmentTokens.some((token) => value.includes(token));
}

function splitCandidateText(value: string) {
  return value
    .split(/[|｜·•\n\r\t]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match?.[1] ? cleanText(match[1]) : null;
}

function matchAll(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].map((match) => match[1] ?? match[0] ?? '');
}

import { fetch } from 'undici';
import type { DiscoveredComponent } from './contracts.js';

const GITHUB_API = 'https://api.github.com';
const MCP_REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0';
const USER_AGENT = 'Tele-OPC-Meta-Agent/0.1';
const MAX_REFERENCE_CHARS = 12000;

export class ComponentDiscoveryService {
  constructor(private readonly githubToken = process.env.GITHUB_TOKEN?.trim() ?? '') {}

  async discover(queries: string[], limit = 12): Promise<DiscoveredComponent[]> {
    const normalizedQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 8);
    const batches = await Promise.allSettled(
      normalizedQueries.flatMap((query) => [this.searchGitHub(query, 5), this.searchMcpRegistry(query, 4)])
    );
    const components = batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : []);
    const deduped = new Map<string, DiscoveredComponent>();
    for (const component of components) {
      const key = `${component.source}:${component.externalId}`;
      const existing = deduped.get(key);
      if (!existing || component.score > existing.score) deduped.set(key, component);
    }
    return [...deduped.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 30)));
  }

  private async searchGitHub(query: string, limit: number): Promise<DiscoveredComponent[]> {
    const githubQuery = buildGitHubQuery(query);
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(githubQuery)}&sort=stars&order=desc&per_page=${limit}`;
    const response = await fetch(url, {
      headers: this.githubHeaders(),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`github_search_failed:${response.status}`);
    const payload = await response.json() as { items?: unknown[] };
    const items = Array.isArray(payload.items) ? payload.items : [];
    return Promise.all(items.map(async (raw) => {
      const item = asRecord(raw);
      const fullName = stringValue(item.full_name);
      const stars = numberValue(item.stargazers_count);
      const pushedAt = stringValue(item.pushed_at);
      const archived = item.archived === true;
      const license = asRecord(item.license);
      const topics = Array.isArray(item.topics) ? item.topics.filter((value): value is string => typeof value === 'string') : [];
      const reference = fullName ? await this.fetchGitHubReadme(fullName).catch(() => '') : '';
      return {
        source: 'github' as const,
        externalId: fullName || stringValue(item.id),
        name: fullName || stringValue(item.name) || 'unknown repository',
        description: stringValue(item.description),
        url: safeHttpsUrl(stringValue(item.html_url)),
        stars,
        score: scoreGitHubCandidate({
          query,
          name: fullName || stringValue(item.name),
          description: stringValue(item.description),
          reference,
          stars,
          pushedAt,
          archived,
          hasLicense: Boolean(stringValue(license.spdx_id)),
          topics
        }),
        metadata: {
          query,
          pushedAt: pushedAt || null,
          language: stringValue(item.language) || null,
          defaultBranch: stringValue(item.default_branch) || null,
          topics,
          license: stringValue(license.spdx_id) || null,
          archived,
          fork: item.fork === true,
          reference: reference.slice(0, MAX_REFERENCE_CHARS),
          mountMode: 'reference_only'
        }
      };
    }));
  }

  private async fetchGitHubReadme(fullName: string) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return '';
    const response = await fetch(`${GITHUB_API}/repos/${fullName}/readme`, {
      headers: this.githubHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return '';
    const payload = await response.json() as { content?: unknown; encoding?: unknown };
    if (payload.encoding !== 'base64' || typeof payload.content !== 'string') return '';
    return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8').slice(0, MAX_REFERENCE_CHARS);
  }

  private async searchMcpRegistry(query: string, limit: number): Promise<DiscoveredComponent[]> {
    const url = `${MCP_REGISTRY_API}/servers?search=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`mcp_registry_search_failed:${response.status}`);
    const payload = await response.json() as { servers?: unknown[] };
    const entries = Array.isArray(payload.servers) ? payload.servers : [];
    return entries.map((raw) => {
      const entry = asRecord(raw);
      const server = asRecord(entry.server);
      const repository = asRecord(server.repository);
      const packages = Array.isArray(server.packages) ? server.packages : [];
      const remotes = Array.isArray(server.remotes) ? server.remotes : [];
      const name = stringValue(server.name) || stringValue(server.title) || 'unknown MCP server';
      const version = stringValue(server.version);
      const sourceUrl = safeHttpsUrl(stringValue(repository.url));
      return {
        source: 'mcp_registry' as const,
        externalId: `${name}@${version || 'latest'}`,
        name: stringValue(server.title) || name,
        description: stringValue(server.description),
        url: sourceUrl || undefined,
        version: version || undefined,
        stars: 0,
        score: scoreMcpCandidate({
          query,
          name,
          description: stringValue(server.description),
          hasRepository: Boolean(sourceUrl),
          packageCount: packages.length,
          remoteCount: remotes.length
        }),
        metadata: {
          query,
          registryName: name,
          packages,
          remotes,
          repository,
          reference: JSON.stringify({ description: server.description, packages, remotes, repository }).slice(0, MAX_REFERENCE_CHARS),
          mountMode: 'descriptor_only'
        }
      };
    });
  }

  private githubHeaders() {
    return {
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      'x-github-api-version': '2022-11-28',
      ...(this.githubToken ? { authorization: `Bearer ${this.githubToken}` } : {})
    };
  }
}

function buildGitHubQuery(query: string) {
  const clean = query.replace(/[^A-Za-z0-9_.+\-\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (/\b(mcp|agent|multi-agent|workflow|automation)\b/i.test(clean)) return `${clean} in:name,description,readme archived:false fork:false`;
  return `${clean} agent MCP in:name,description,readme archived:false fork:false`;
}

function scoreGitHubCandidate(params: {
  query: string;
  name: string;
  description: string;
  reference: string;
  stars: number;
  pushedAt: string;
  archived: boolean;
  hasLicense: boolean;
  topics: string[];
}) {
  if (params.archived) return 0;
  const relevance = relevanceScore(params.query, `${params.name} ${params.description} ${params.topics.join(' ')} ${params.reference.slice(0, 3000)}`);
  const starsScore = Math.min(25, Math.log10(Math.max(1, params.stars)) * 6.5);
  const ageDays = params.pushedAt ? Math.max(0, (Date.now() - Date.parse(params.pushedAt)) / 86400000) : 3650;
  const freshnessScore = Math.max(0, 20 - Math.log10(ageDays + 1) * 8);
  const licenseScore = params.hasLicense ? 10 : 0;
  const topicScore = Math.min(15, params.topics.filter((topic) => /agent|mcp|llm|automation|workflow/i.test(topic)).length * 3.75);
  const listPenalty = /(^|\/)(awesome[-_]|awesome$)|curated list|collection of/i.test(`${params.name} ${params.description}`) ? 22 : 0;
  return roundScore(relevance * 0.3 + starsScore + freshnessScore + licenseScore + topicScore - listPenalty);
}

function scoreMcpCandidate(params: {
  query: string;
  name: string;
  description: string;
  hasRepository: boolean;
  packageCount: number;
  remoteCount: number;
}) {
  const relevance = relevanceScore(params.query, `${params.name} ${params.description}`);
  return roundScore(
    25 + relevance * 0.35 + (params.hasRepository ? 12 : 0)
    + Math.min(14, params.packageCount * 7) + Math.min(14, params.remoteCount * 7)
  );
}

function relevanceScore(query: string, text: string) {
  const stopWords = new Set(['agent', 'agents', 'ai', 'mcp', 'github', 'latest', 'tool', 'tools', 'system', 'service', 'services', 'workflow']);
  const queryTokens = tokenize(query).filter((token) => !stopWords.has(token));
  if (!queryTokens.length) return 50;
  const haystack = new Set(tokenize(text));
  const matches = queryTokens.filter((token) => haystack.has(token)).length;
  return Math.min(100, (matches / queryTokens.length) * 100);
}

function tokenize(value: string) {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9_.+-]{1,}/g) ?? [];
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 1000) / 1000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

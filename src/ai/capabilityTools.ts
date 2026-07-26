import { readPage, webSearch } from '../prospecting/webSearch.js';
import type { AgentTool } from './agentRunner.js';

/**
 * Repository surface the capability tools need. Kept structural so both the
 * real Repositories class and test fakes satisfy it.
 */
export interface CapabilityToolRepositories {
  searchLeads(params: { query?: string; limit: number; offset: number }): Promise<{
    total: number;
    leads: ReadonlyArray<{
      id: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      notes?: string | null;
      organization_name?: string | null;
    }>;
  }>;
  createCrmLead(params: {
    name: string;
    organizationName?: string;
    interest?: string;
    note: string;
  }): Promise<{ contact: { id: string } }>;
  createArtifact(params: {
    taskId?: string;
    type: string;
    title: string;
    uri?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * General-purpose capabilities every operating agent can call directly.
 *
 * These exist so new kinds of work do not each need a bespoke engine. Before
 * this, searching the web and reading pages were reimplemented inside
 * leadCampaign and marketScan, and normal agents could only talk about doing
 * things because they were given no tools at all.
 */
export function buildCapabilityTools(
  repos: CapabilityToolRepositories,
  options: { taskId?: string } = {}
): AgentTool[] {
  return [
    {
      name: 'search_web',
      description:
        'Search the public web and return titles, URLs and snippets. Use this whenever you need current facts, prices, market demand, company details or anything you cannot already know. You may call it several times with different angles.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Chinese is fine.' },
          limit: { type: 'number', description: 'Max results, 1-10. Defaults to 8.' }
        },
        required: ['query'],
        additionalProperties: false
      },
      async execute(input) {
        const query = String(input.query ?? '').trim();
        if (!query) return { error: 'query_required' };
        const limit = Math.max(1, Math.min(10, Number(input.limit) || 8));
        const hits = await webSearch(query, limit);
        return { query, count: hits.length, results: hits };
      }
    },
    {
      name: 'read_url',
      description:
        'Fetch the readable text of one or more web pages. Use after search_web to get the real content behind a link instead of guessing from the snippet.',
      parameters: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Up to 5 URLs to read.'
          },
          maxChars: { type: 'number', description: 'Chars per page, defaults to 6000.' }
        },
        required: ['urls'],
        additionalProperties: false
      },
      async execute(input) {
        const urls = Array.isArray(input.urls)
          ? input.urls.filter((url): url is string => typeof url === 'string').slice(0, 5)
          : [];
        if (!urls.length) return { error: 'urls_required' };
        const maxChars = Math.max(500, Math.min(12000, Number(input.maxChars) || 6000));
        const pages = await mapPool(urls, 3, async (url) => ({
          url,
          text: await readPage(url, maxChars).catch(() => '')
        }));
        return { pages: pages.map((page) => ({ ...page, empty: page.text.length < 200 })) };
      }
    },
    {
      name: 'search_crm',
      description:
        'Search leads and contacts already stored in our own CRM. Use before going to the open web when the answer may already be in our database.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional keyword over name, company and notes.' },
          limit: { type: 'number', description: 'Max rows, 1-50. Defaults to 20.' }
        },
        additionalProperties: false
      },
      async execute(input) {
        const limit = Math.max(1, Math.min(50, Number(input.limit) || 20));
        const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : undefined;
        const { total, leads } = await repos.searchLeads({ query, limit, offset: 0 });
        return {
          total,
          returned: leads.length,
          leads: leads.map((lead) => ({
            id: lead.id,
            name: lead.name,
            organization: lead.organization_name ?? null,
            email: lead.email ?? null,
            phone: lead.phone ?? null,
            notes: typeof lead.notes === 'string' ? lead.notes.slice(0, 600) : null
          }))
        };
      }
    },
    {
      name: 'save_lead',
      description:
        'Write a new lead into our CRM. Only use for real companies or people you actually found. Never invent contact details.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          organizationName: { type: 'string' },
          interest: { type: 'string', description: 'What they might buy.' },
          note: { type: 'string', description: 'Evidence, signals, source URL and outreach angle.' }
        },
        required: ['name', 'note'],
        additionalProperties: false
      },
      async execute(input) {
        const name = String(input.name ?? '').trim();
        const note = String(input.note ?? '').trim();
        if (!name || !note) return { error: 'name_and_note_required' };
        const result = await repos.createCrmLead({
          name,
          organizationName: typeof input.organizationName === 'string' ? input.organizationName : undefined,
          interest: typeof input.interest === 'string' ? input.interest : undefined,
          note
        });
        return { saved: true, contactId: result.contact.id };
      }
    },
    {
      name: 'save_deliverable',
      description:
        'Persist a finished deliverable (report, plan, copy, spec) so the owner can open it in the console instead of only reading a chat message. Use when your output is long or meant to be reused.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: { type: 'string', description: 'e.g. report, plan, copy, analysis.' },
          content: { type: 'string', description: 'Full markdown content.' }
        },
        required: ['title', 'content'],
        additionalProperties: false
      },
      async execute(input) {
        const title = String(input.title ?? '').trim();
        const content = String(input.content ?? '').trim();
        if (!title || !content) return { error: 'title_and_content_required' };
        const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim() : 'report';
        const artifact = await repos.createArtifact({
          taskId: options.taskId,
          type,
          title,
          uri: options.taskId ? `tele-opc://artifacts/${type}/${options.taskId}` : undefined,
          content,
          metadata: { source: 'agent_capability_tool' }
        });
        return { saved: true, artifactId: artifact.id };
      }
    }
  ];
}

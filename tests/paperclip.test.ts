import { describe, expect, it, vi } from 'vitest';
import { PaperclipClient } from '../src/integrations/paperclip/client.js';
import { paperclipTaskLink, resolveTeleOpcAgent } from '../src/integrations/paperclip/bridge.js';
import type { TaskRecord } from '../src/types.js';

describe('Paperclip integration', () => {
  it('maps Paperclip organizational roles to Tele-OPC agents', () => {
    expect(resolveTeleOpcAgent({ id: 'a1', role: 'Finance Director' })).toBe('finance');
    expect(resolveTeleOpcAgent({ id: 'a2', name: 'Growth Sales Agent' })).toBe('prospecting');
    expect(resolveTeleOpcAgent({ id: 'a3', role: 'Software Engineer' })).toBe('dev');
    expect(resolveTeleOpcAgent(null, { teleOpcAgent: 'content' })).toBe('content');
    expect(resolveTeleOpcAgent({ id: 'a4', role: 'General Manager' })).toBe('chief_of_staff');
  });

  it('calls Paperclip issue API with bearer and run headers', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(
      JSON.stringify({ id: 'iss_1', title: 'Issue', status: 'done' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    const client = new PaperclipClient({ apiUrl: 'http://paperclip.local/', apiKey: 'pc_key', fetch: fetchMock as typeof fetch });
    await client.updateIssue('iss_1', { status: 'done', comment: 'finished' }, 'run_1');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://paperclip.local/api/issues/iss_1');
    expect(init?.method).toBe('PATCH');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer pc_key');
    expect((init?.headers as Record<string, string>)['x-paperclip-run-id']).toBe('run_1');
  });

  it('loads governance resources through the authenticated Paperclip client', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify(String(url).endsWith('/api/companies') ? [{ id: 'co_1', name: 'Company' }] : []),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    const client = new PaperclipClient({ apiUrl: 'http://paperclip.local', apiKey: 'board_key', fetch: fetchMock as typeof fetch });
    await client.listCompanies();
    await client.listGoals('co_1');
    await client.listProjects('co_1');
    await client.listAgents('co_1');
    await client.listIssues('co_1');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'http://paperclip.local/api/companies',
      'http://paperclip.local/api/companies/co_1/goals',
      'http://paperclip.local/api/companies/co_1/projects',
      'http://paperclip.local/api/companies/co_1/agents',
      'http://paperclip.local/api/companies/co_1/issues'
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer board_key');
    }
  });

  it('extracts durable Paperclip task linkage from planning metadata', () => {
    const task = {
      planning_metadata: { paperclip: { issueId: 'iss_1', runId: 'run_1', agentId: 'agent_1' } }
    } as unknown as TaskRecord;
    expect(paperclipTaskLink(task)).toEqual({ issueId: 'iss_1', runId: 'run_1', agentId: 'agent_1' });
  });
});

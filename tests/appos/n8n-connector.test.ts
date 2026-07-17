import { describe, expect, it } from 'vitest';
import { N8nConnector } from '../../src/appos/connectors/n8n.js';

describe('N8nConnector', () => {
  it('calls a webhook with run id and input', async () => {
    const calls: unknown[] = [];
    const connector = new N8nConnector({
      fetch: async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ executionId: 'exec_001', accepted: true }), { status: 200 });
      }
    });

    const result = await connector.startWebhookRun({
      webhookUrl: 'https://n8n.example/webhook/content',
      runId: 'run_001',
      traceId: 'trace_001',
      input: { topic: 'AI tools CPS' }
    });

    expect(result.externalExecutionId).toBe('exec_001');
    expect(calls[0]).toMatchObject({ runId: 'run_001', traceId: 'trace_001' });
  });
});

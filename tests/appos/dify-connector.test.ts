import { describe, expect, it } from 'vitest';
import { DifyConnector } from '../../src/appos/connectors/dify.js';

describe('DifyConnector', () => {
  it('normalizes Dify workflow output', async () => {
    const connector = new DifyConnector({
      baseUrl: 'https://dify.example',
      apiKey: 'test',
      fetch: async () =>
        new Response(JSON.stringify({ workflow_run_id: 'dify_run_001', data: { outputs: { title: 'CPS title' } } }), {
          status: 200
        })
    });

    const result = await connector.runWorkflow({
      inputs: { topic: 'AI tools CPS' },
      user: 'tele-opc'
    });

    expect(result.externalExecutionId).toBe('dify_run_001');
    expect(result.output).toEqual({ title: 'CPS title' });
  });

  it('rejects malformed Dify outputs', async () => {
    const connector = new DifyConnector({
      baseUrl: 'https://dify.example',
      apiKey: 'test',
      fetch: async () =>
        new Response(JSON.stringify({ workflow_run_id: 'dify_run_002', data: { outputs: 'bad' } }), { status: 200 })
    });

    await expect(connector.runWorkflow({ inputs: {}, user: 'tele-opc' })).rejects.toThrow('malformed');
  });
});

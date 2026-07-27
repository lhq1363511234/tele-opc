import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('undici', () => ({ fetch: fetchMock }));

import { OpenAICompatibleModelProvider } from '../src/ai/modelProvider.js';

function response(status: number, payload: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => payload
  };
}

describe('OpenAICompatibleModelProvider', () => {
  beforeEach(() => fetchMock.mockReset());

  it('retries a transient busy response and returns the next successful answer', async () => {
    fetchMock
      .mockResolvedValueOnce(response(429, { error: { message: 'all accounts are busy', type: 'proxy_busy' } }))
      .mockResolvedValueOnce(response(200, {
        choices: [{ message: { content: '已理解当前原话', tool_calls: [] } }]
      }));

    const provider = new OpenAICompatibleModelProvider({
      provider: 'test', baseUrl: 'https://model.invalid/v1', apiKey: 'secret', model: 'test-model'
    });
    const result = await provider.chat({ messages: [{ role: 'user', content: '只复述我的目标' }] });

    expect(result.content).toBe('已理解当前原话');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent authentication failure', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: { message: 'invalid key' } }));
    const provider = new OpenAICompatibleModelProvider({
      provider: 'test', baseUrl: 'https://model.invalid/v1', apiKey: 'secret', model: 'test-model'
    });

    await expect(provider.chat({ messages: [{ role: 'user', content: 'hello' }] }))
      .rejects.toThrow('model_request_failed:401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

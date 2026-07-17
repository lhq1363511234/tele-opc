type FetchLike = typeof fetch;

export class N8nConnector {
  private readonly fetchImpl: FetchLike;

  constructor(options: { fetch?: FetchLike } = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async startWebhookRun(input: {
    webhookUrl: string;
    runId: string;
    traceId: string;
    input: Record<string, unknown>;
  }) {
    const response = await this.fetchImpl(input.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: input.runId,
        traceId: input.traceId,
        input: input.input
      })
    });

    if (!response.ok) {
      throw new Error(`n8n webhook failed: ${response.status}`);
    }

    const data = (await response.json()) as { executionId?: string; id?: string };
    return {
      externalExecutionId: data.executionId ?? data.id,
      rawOutput: data
    };
  }
}

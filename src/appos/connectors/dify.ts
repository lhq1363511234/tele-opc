type FetchLike = typeof fetch;

export class DifyConnector {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { baseUrl: string; apiKey: string; fetch?: FetchLike }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async runWorkflow(input: { inputs: Record<string, unknown>; user: string }) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/workflows/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        inputs: input.inputs,
        response_mode: 'blocking',
        user: input.user
      })
    });

    if (!response.ok) {
      throw new Error(`Dify workflow failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      workflow_run_id?: string;
      data?: { outputs?: Record<string, unknown> };
    };
    const output = data.data?.outputs ?? {};
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new Error('Dify workflow output malformed');
    }

    return {
      externalExecutionId: data.workflow_run_id,
      output,
      rawOutput: data
    };
  }
}

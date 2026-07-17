type FetchLike = typeof fetch;

const ensureCapcutOk = async (response: Response, operation: string) => {
  if (!response.ok) {
    throw new Error(`capcut-mate ${operation} failed: ${response.status}`);
  }
  const data = (await response.json()) as { code?: number; draft_url?: string; message?: string };
  if (data.code !== 0) {
    throw new Error(`capcut-mate ${operation} failed: ${data.message ?? 'unknown error'}`);
  }
  return data;
};

export class CapcutMateConnector {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { baseUrl: string; fetch?: FetchLike }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createSimpleDraft(input: {
    width: number;
    height: number;
    audioUrl: string;
    text?: string;
    imageUrl?: string;
    videoUrl?: string;
  }) {
    const create = await ensureCapcutOk(
      await this.fetchImpl(`${this.baseUrl}/openapi/capcut-mate/v1/create_draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ width: input.width, height: input.height })
      }),
      'create_draft'
    );
    if (!create.draft_url) {
      throw new Error('capcut-mate create_draft did not return draft_url');
    }

    await ensureCapcutOk(
      await this.fetchImpl(`${this.baseUrl}/openapi/capcut-mate/v1/easy_create_material`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          draft_url: create.draft_url,
          audio_url: input.audioUrl,
          text: input.text ?? null,
          img_url: input.imageUrl ?? null,
          video_url: input.videoUrl ?? null
        })
      }),
      'easy_create_material'
    );

    await ensureCapcutOk(
      await this.fetchImpl(`${this.baseUrl}/openapi/capcut-mate/v1/save_draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_url: create.draft_url })
      }),
      'save_draft'
    );

    return { draftUrl: create.draft_url };
  }
}

export function capcutDraftToArtifact(input: { draftUrl: string; sourceRunId: string; title: string }) {
  return {
    id: `art_${input.sourceRunId}_capcut_draft`,
    type: 'capcut_draft' as const,
    title: input.title,
    sourceRunId: input.sourceRunId,
    draftUrl: input.draftUrl,
    status: 'created' as const,
    version: 1
  };
}

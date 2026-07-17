import { describe, expect, it } from 'vitest';
import { CapcutMateConnector, capcutDraftToArtifact } from '../../src/appos/connectors/capcut-mate.js';

describe('CapcutMateConnector', () => {
  it('creates and saves a draft through capcut-mate', async () => {
    const urls: string[] = [];
    const connector = new CapcutMateConnector({
      baseUrl: 'http://127.0.0.1:30000',
      fetch: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith('/create_draft')) {
          return new Response(JSON.stringify({ code: 0, draft_url: 'draft://001' }), { status: 200 });
        }
        if (String(url).endsWith('/easy_create_material')) {
          return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
    });

    const result = await connector.createSimpleDraft({
      width: 1080,
      height: 1920,
      audioUrl: 'https://example.com/audio.mp3',
      text: 'CPS script',
      imageUrl: 'https://example.com/image.png'
    });

    expect(result.draftUrl).toBe('draft://001');
    expect(urls.some((url) => url.endsWith('/save_draft'))).toBe(true);
  });

  it('maps draft URLs into artifact records', () => {
    const artifact = capcutDraftToArtifact({
      draftUrl: 'draft://001',
      sourceRunId: 'run_001',
      title: 'CPS draft'
    });

    expect(artifact.type).toBe('capcut_draft');
    expect(artifact.draftUrl).toBe('draft://001');
  });
});

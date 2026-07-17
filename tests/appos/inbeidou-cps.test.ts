import { describe, expect, it } from 'vitest';
import {
  buildDifyPayload,
  buildFeishuBatchPayloads,
  normalizeInbeidouResults,
  parseCommissionRate
} from '../../src/appos/domains/cps/inbeidou.js';

describe('inbeidou cps normalization', () => {
  it('parses commission percentages as decimals', () => {
    expect(parseCommissionRate('分佣比例：50%')).toBe(0.5);
    expect(parseCommissionRate('65%')).toBe(0.65);
    expect(parseCommissionRate(0.35)).toBe(0.35);
    expect(parseCommissionRate('unknown')).toBeNull();
  });

  it('builds Feishu Base batch payloads from scraped task results', () => {
    const [task] = normalizeInbeidouResults([
      {
        taskId: '842501',
        appId: 'moboreels',
        enName: 'Bestie Ruined My Wedding? Fine, I Am Screwing Her Life!',
        platform: 'MoboReels',
        platformSideId: '5115',
        episodeCount: '10集 | 英文',
        language: '英文',
        commissionRate: '分佣比例：50%',
        promoCopy: 'A revenge wedding drama.',
        coverImageUrl: 'https://example.test/cover.png',
        promoLinks: {
          facebook: 'https://eng.moboreels.com/VTMBi/842501',
          tiktok: 'https://example.test/tiktok'
        },
        downloadedFiles: [['episode_video', 'B:/materials/ep4.mp4', 'https://example.test/ep4.mp4']]
      }
    ]);

    expect(task.productId).toBe('cps_inbeidou_moboreels_842501');
    expect(task.episodeCount).toBe(10);
    expect(task.commissionRate).toBe(0.5);

    const payloads = buildFeishuBatchPayloads([task], new Date(2026, 5, 25, 1, 2, 3));

    expect(payloads.CPSProducts.rows[0]?.slice(0, 9)).toEqual([
      'cps_inbeidou_moboreels_842501',
      'Bestie Ruined My Wedding? Fine, I Am Screwing Her Life!',
      'https://eng.moboreels.com/VTMBi/842501',
      0.5,
      null,
      'A revenge wedding drama.',
      'No auto-publish. Keep original dialogue clear. Do not publish without owner approval.',
      'ready',
      '2026-06-25 01:02:03'
    ]);
    expect(payloads.CPSProducts.fields).toEqual(
      expect.arrayContaining([
        'source_platform',
        'source_site_name',
        'drama_id',
        'source_task_id',
        'title_en',
        'title_cn',
        '中文剧名',
        '英文剧名',
        '平台ID',
        '封面本地路径',
        '短剧推广链接',
        '数据原文'
      ])
    );
    expect(payloads.CPSProducts.fields.some((field) => /[涓鑻骞鍖搴鐭灏]/.test(field))).toBe(false);
    const productFields = payloads.CPSProducts.fields;
    const productRow = payloads.CPSProducts.rows[0] ?? [];
    expect(productRow[productFields.indexOf('source_platform')]).toBe('inbeidou');
    expect(productRow[productFields.indexOf('source_site_name')]).toBe('北斗智影');
    expect(productRow[productFields.indexOf('平台名称')]).toBe('MoboReels');
    expect(productRow[productFields.indexOf('平台ID')]).toBe('5115');

    expect(payloads.SourceMaterials.rows).toHaveLength(2);
    expect(payloads.SourceMaterials.fields).toEqual(
      expect.arrayContaining(['素材名称', '素材说明', 'source_platform', 'source_site_name', 'drama_id', '素材角色', '素材动作'])
    );
    expect(payloads.PublishRecords.rows).toHaveLength(2);
    expect(payloads.PublishRecords.rows[0][3]).toBe('other');
    expect(payloads.PublishRecords.fields).toEqual(
      expect.arrayContaining(['推广平台', '短剧推广链接', 'APP推广链接', '推广文案', 'source_platform', 'source_site_name', 'publish_status'])
    );
  });

  it('builds Dify payload for short-drama edit planning', () => {
    const tasks = normalizeInbeidouResults([
      {
        taskId: '1378813831',
        appId: 'moboreels',
        enName: "The Mercenary's Forbidden Queen",
        platform: 'MoboReels',
        commissionRate: '50%',
        promoLinks: { facebook: 'https://example.test/fb' }
      }
    ]);

    const payload = buildDifyPayload(tasks, {
      operator: 'opctoai',
      editBriefPath: 'D:/360MoveData/Users/Cir/Desktop/剪辑思路.txt'
    });

    expect(payload.workflow).toBe('short_drama_cps_edit_plan');
    expect(payload.operator).toBe('opctoai');
    expect(payload.tasks[0]?.requiredOutput).toContain('edit_plan');
    expect(payload.tasks[0]?.constraints).toContain('Do not auto-publish');
  });

  it('keeps Inbeidou serial/app/copy promo link objects usable downstream', () => {
    const [task] = normalizeInbeidouResults([
      {
        taskId: '2075159024',
        appId: 'stardusttv',
        enName: 'Claimed by the Dragon',
        platform: 'StardustTV',
        promoLinks: {
          facebook: {
            serial: 'https://short.inbeidou.ai/link/stardusttv/serial/abc/12',
            app: 'https://short.inbeidou.ai/link/stardusttv/app/def/12',
            copy: 'watch https://short.inbeidou.ai/link/stardusttv/serial/abc/12'
          }
        }
      }
    ]);

    const payloads = buildFeishuBatchPayloads([task], new Date(2026, 5, 25, 1, 2, 3));

    expect(task.promoLinks.facebook?.serial).toBe('https://short.inbeidou.ai/link/stardusttv/serial/abc/12');
    expect(payloads.CPSProducts.rows[0][2]).toBe('https://short.inbeidou.ai/link/stardusttv/serial/abc/12');
    expect(payloads.PublishRecords.rows[0][5]).toBe('https://short.inbeidou.ai/link/stardusttv/serial/abc/12');
    expect(JSON.parse(String(payloads.PublishRecords.rows[0][13]))).toMatchObject({
      appUrl: 'https://short.inbeidou.ai/link/stardusttv/app/def/12',
      promoCopy: 'watch https://short.inbeidou.ai/link/stardusttv/serial/abc/12'
    });
    expect(payloads.PublishRecords.rows[0][14]).toBe('Facebook');
    expect(payloads.PublishRecords.rows[0][15]).toBe('https://short.inbeidou.ai/link/stardusttv/serial/abc/12');
    expect(payloads.PublishRecords.rows[0][16]).toBe('https://short.inbeidou.ai/link/stardusttv/app/def/12');
    expect(payloads.PublishRecords.rows[0][17]).toBe('watch https://short.inbeidou.ai/link/stardusttv/serial/abc/12');
  });

  it('keeps Feishu material rows readable and stores subtitles as resources', () => {
    const [task] = normalizeInbeidouResults([
      {
        taskId: '2075159024',
        appId: 'stardusttv',
        enName: 'Claimed by the Dragon',
        platform: 'StardustTV',
        coverImageUrl: 'https://example.test/cover.png',
        promoLinks: { facebook: 'https://example.test/fb' },
        downloadedFiles: [['cover_image', 'B:/materials/cover.png', 'https://example.test/cover.png']]
      }
    ]);
    task.mediaEpisodes = [
      {
        episodeNumber: 1,
        video: {
          episodeNumber: 1,
          kind: 'episode_video_1',
          localPath: 'B:/materials/ep1.mp4',
          sourceUrl: 'https://example.test/ep1.mp4'
        },
        analysisDir: 'B:/analysis/ep1',
        transcriptPath: 'B:/analysis/ep1/transcript.srt',
        reportPath: 'B:/analysis/ep1/media_preprocess_report.json',
        report: {
          source: { inputPath: 'B:/materials/ep1.mp4', sha256: 'sha256' },
          probe: {
            durationSeconds: 96.5,
            sizeBytes: 1024,
            bitrate: 900000,
            width: 720,
            height: 1280,
            aspectRatio: '9:16',
            orientation: 'vertical',
            frameRate: 30,
            videoCodec: 'h264',
            audioCodec: 'aac',
            audioChannels: 2,
            audioSampleRate: 48000
          },
          screenshots: [
            { timeSeconds: 10, path: 'B:/analysis/ep1/screenshots/01.jpg' },
            { timeSeconds: 20, path: 'B:/analysis/ep1/screenshots/02.jpg' },
            { timeSeconds: 30, path: 'B:/analysis/ep1/screenshots/03.jpg' },
            { timeSeconds: 40, path: 'B:/analysis/ep1/screenshots/04.jpg' }
          ],
          keyframes: [{ timeSeconds: 0, pictType: 'I' }],
          quality: {
            blackIntervals: [],
            blackDurationSeconds: 0,
            blackRatio: 0,
            silenceIntervals: [],
            silenceDurationSeconds: 10,
            dialogueDensity: 0.8964
          },
          asr: {
            status: 'done',
            language: 'en',
            transcriptPath: 'B:/analysis/ep1/transcript.srt',
            transcriptText: `${'line '.repeat(400)}important ending`,
            segments: [{ start: '00:00:01,000', end: '00:00:03,000', text: 'full segment text should not live in Base JSON' }]
          },
          outputs: {
            probeJsonPath: 'B:/analysis/ep1/ffprobe.json',
            audioPath: 'B:/analysis/ep1/audio.wav',
            blackdetectLogPath: 'B:/analysis/ep1/blackdetect.log',
            silencedetectLogPath: 'B:/analysis/ep1/silencedetect.log',
            reportPath: 'B:/analysis/ep1/media_preprocess_report.json',
            difyPayloadPath: 'B:/analysis/ep1/dify_media_preprocess_payload.json'
          }
        }
      }
    ];

    const payloads = buildFeishuBatchPayloads([task], new Date(2026, 5, 25, 1, 2, 3));
    const fields = payloads.SourceMaterials.fields;
    const rows = payloads.SourceMaterials.rows;
    const roleIndex = fields.indexOf('material_role');
    const episodeIndex = fields.indexOf('episode_number');
    const storageIndex = fields.indexOf('storage_ref');
    const contextIndex = fields.indexOf('media_context_json');

    expect(rows).toHaveLength(3);
    const videoRow = rows.find((row) => row[roleIndex] === 'episode_video');
    const subtitleRow = rows.find((row) => row[roleIndex] === 'subtitle');
    expect(videoRow?.[episodeIndex]).toBe(1);
    expect(subtitleRow?.[storageIndex]).toBe('B:/analysis/ep1/transcript.srt');

    const context = JSON.parse(String(videoRow?.[contextIndex]));
    expect(context).toMatchObject({
      productId: 'cps_inbeidou_stardusttv_2075159024',
      episodeNumber: 1,
      screenshotCount: 4,
      transcriptStatus: 'done',
      transcriptPath: 'B:/analysis/ep1/transcript.srt',
      reportPath: 'B:/analysis/ep1/media_preprocess_report.json'
    });
    expect(context.screenshotSamplePaths).toHaveLength(3);
    expect(context.transcriptPreview.length).toBeLessThanOrEqual(1000);
    expect(String(videoRow?.[contextIndex])).not.toContain('full segment text should not live in Base JSON');
    expect(String(videoRow?.[contextIndex]).length).toBeLessThan(2500);
  });
});

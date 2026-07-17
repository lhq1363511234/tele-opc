import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import {
  InbeidouCpsModule,
  registerInbeidouCpsRoutes
} from '../../src/appos/domains/cps/inbeidou-module.js';

const tempDirs: string[] = [];

async function tempOutputDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tele-opc-inbeidou-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Inbeidou CPS module', () => {
  it('builds a safe scraper command for selected task indices', () => {
    const module = new InbeidouCpsModule({
      scraperScript: 'runtime/inbeidou-cps-skill/inbeidou-cps/scripts/cps_scrape.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output'
    });

    const command = module.buildScrapeCommand({
      tasks: [0, 3],
      noDownload: true,
      noLinks: false
    });

    expect(command.command).toBe('python');
    expect(command.args).toEqual([
      'runtime/inbeidou-cps-skill/inbeidou-cps/scripts/cps_scrape.py',
      '--output',
      'runtime/inbeidou-cps-output',
      '--tasks',
      '0',
      '3',
      '--no-download'
    ]);
    expect(command.env.CPS_OUTPUT_DIR).toBe('runtime/inbeidou-cps-output');
  });

  it('rejects unsafe task indices before browser automation starts', () => {
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output'
    });

    expect(() => module.buildScrapeCommand({ tasks: [-1] })).toThrow('tasks must be non-negative integers');
    expect(() => module.buildScrapeCommand({ tasks: [1.5] })).toThrow('tasks must be non-negative integers');
  });

  it('normalizes completed scraper results into downstream payloads', async () => {
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output',
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          {
            taskId: '842501',
            appId: 'moboreels',
            enName: 'Bestie Ruined My Wedding? Fine, I Am Screwing Her Life!',
            platform: 'MoboReels',
            commissionRate: '50%',
            promoLinks: { facebook: 'https://eng.moboreels.com/VTMBi/842501' }
          }
        ])
    });

    const result = await module.ingest({
      tasks: [0],
      noDownload: true,
      noLinks: false,
      writeFeishu: false,
      triggerDify: false
    });

    expect(result.status).toBe('done');
    expect(result.tasks[0]?.productId).toBe('cps_inbeidou_moboreels_842501');
    expect(result.feishuPayloads.CPSProducts.rows).toHaveLength(1);
    expect(result.difyPayload.workflow).toBe('short_drama_cps_edit_plan');
  });

  it('runs configured Feishu and Dify downstream hooks when requested', async () => {
    const writtenTables: string[] = [];
    const difyWorkflows: string[] = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output',
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          {
            taskId: '842501',
            appId: 'moboreels',
            enName: 'Bestie Ruined My Wedding? Fine, I Am Screwing Her Life!',
            platform: 'MoboReels',
            commissionRate: '50%',
            coverImageUrl: 'https://example.test/cover.png',
            promoLinks: { facebook: 'https://eng.moboreels.com/VTMBi/842501' }
          }
        ]),
      feishuWriter: async ({ tableName }) => {
        writtenTables.push(tableName);
      },
      difyTrigger: async ({ payload }) => {
        difyWorkflows.push(String(payload.workflow));
      }
    });

    const result = await module.ingest({
      tasks: [0],
      writeFeishu: true,
      triggerDify: true
    });

    expect(result.downstream.feishuWrites.map((write) => write.tableName)).toEqual([
      'CPSProducts',
      'SourceMaterials',
      'PublishRecords'
    ]);
    expect(writtenTables).toEqual(['CPSProducts', 'SourceMaterials', 'PublishRecords']);
    expect(difyWorkflows).toEqual(['short_drama_cps_edit_plan']);
    expect(result.downstream.difyTriggered).toBe(true);
  });

  it('preprocesses downloaded episode videos before writing Feishu Base payloads', async () => {
    const outputDir = await tempOutputDir();
    const writtenTables: Array<{ tableName: string; payload: { fields: string[]; rows: unknown[][] } }> = [];
    const preprocessedInputs: string[] = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          {
            taskId: '2075159024',
            appId: 'stardusttv',
            enName: 'Claimed by the Dragon',
            platform: 'StardustTV',
            commissionRate: '65%',
            promoLinks: { facebook: 'https://example.test/fb' },
            downloadedFiles: [
              ['cover_image', 'B:/materials/cover.png', 'https://example.test/cover.png'],
              ['episode_video_1', 'B:/materials/ep1.mp4', 'https://example.test/ep1.mp4']
            ]
          }
        ]),
      mediaPreprocess: (options) => {
        preprocessedInputs.push(options.inputPath);
        return {
          source: { inputPath: options.inputPath, sha256: 'sha256' },
          probe: {
            durationSeconds: 96,
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
          screenshots: [{ timeSeconds: 10, path: 'B:/analysis/ep1/screenshots/01.jpg' }],
          keyframes: [],
          quality: {
            blackIntervals: [],
            blackDurationSeconds: 0,
            blackRatio: 0,
            silenceIntervals: [],
            silenceDurationSeconds: 10,
            dialogueDensity: 0.89
          },
          asr: {
            status: 'done',
            language: 'en',
            transcriptPath: 'B:/analysis/ep1/transcript.srt',
            transcriptText: 'English subtitle transcript',
            segments: []
          },
          outputs: {
            probeJsonPath: 'B:/analysis/ep1/ffprobe.json',
            audioPath: 'B:/analysis/ep1/audio.wav',
            blackdetectLogPath: 'B:/analysis/ep1/blackdetect.log',
            silencedetectLogPath: 'B:/analysis/ep1/silencedetect.log',
            reportPath: 'B:/analysis/ep1/media_preprocess_report.json',
            difyPayloadPath: 'B:/analysis/ep1/dify_media_preprocess_payload.json'
          }
        };
      },
      feishuWriter: async ({ tableName, payload }) => {
        writtenTables.push({ tableName, payload });
      }
    });

    const result = await module.ingest({
      tasks: [0],
      writeFeishu: true,
      triggerDify: false
    });

    expect(preprocessedInputs).toEqual(['B:/materials/ep1.mp4']);
    expect(result.tasks[0]?.mediaEpisodes).toHaveLength(1);
    expect(result.downstream.feishuWrites.map((write) => write.tableName)).toEqual([
      'CPSProducts',
      'SourceMaterials',
      'MediaJobs',
      'PublishRecords'
    ]);
    const sourceMaterials = writtenTables.find((write) => write.tableName === 'SourceMaterials')?.payload;
    const roleIndex = sourceMaterials?.fields.indexOf('material_role') ?? -1;
    const storageIndex = sourceMaterials?.fields.indexOf('storage_ref') ?? -1;
    expect(sourceMaterials?.rows.some((row) => row[roleIndex] === 'subtitle' && row[storageIndex] === 'B:/analysis/ep1/transcript.srt')).toBe(true);
  });

  it('exposes a route for n8n to trigger module 4', async () => {
    const app = Fastify();
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output',
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          {
            taskId: '1378813831',
            appId: 'moboreels',
            enName: "The Mercenary's Forbidden Queen",
            platform: 'MoboReels',
            commissionRate: '50%',
            promoLinks: { facebook: 'https://example.test/fb' }
          }
        ])
    });
    registerInbeidouCpsRoutes(app, module);

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/ingest',
      payload: {
        tasks: [0],
        noDownload: true,
        writeFeishu: false,
        triggerDify: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json().tasks[0].taskId).toBe('1378813831');
  });

  it('discovers site platform tabs for Feishu selection after prerequisites are ready', async () => {
    const sequence: string[] = [];
    const outputDir = await tempOutputDir();
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async ({ stage, requiredDependencies }) => {
        sequence.push(`ensure:${stage}:${requiredDependencies.join(',')}`);
        return {
          ok: true,
          services: requiredDependencies.map((id) => ({ id, ok: true, message: 'ok' }))
        };
      },
      runner: async ({ args }) => {
        sequence.push(`runner:${args.join(' ')}`);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async (filePath) => {
        if (filePath.endsWith('platform_tabs.json')) {
          return JSON.stringify([
            { index: 0, name: 'all' },
            { index: 1, name: 'DramaBox' },
            { index: 2, name: 'ShortMax' }
          ]);
        }
        expect(filePath).toBe(path.join(outputDir, 'task_candidates.json'));
        return JSON.stringify([
          { index: 0, displayIndex: 1, enName: 'Drama A', platform: 'DramaBox', commissionRate: '65%' },
          { index: 1, displayIndex: 2, enName: 'Drama B', platform: 'DramaBox', commissionRate: '50%' }
        ]);
      }
    });

    const result = await module.discoverForFeishu({ outputDir });

    expect(sequence[0]).toBe('ensure:discover:n8n,dify,cloakbrowser,inbeidou_profile,capcut_mate,feishu_im');
    expect(sequence[1]).toContain('--list-only');
    expect(result.platforms.map((platform) => [platform.name, platform.count])).toEqual([
      ['all', 0],
      ['DramaBox', 0],
      ['ShortMax', 0]
    ]);
    expect(JSON.stringify(result.card)).toContain('选择北斗智影平台');
    expect(JSON.stringify(result.card)).toContain('DramaBox');
    expect(JSON.stringify(result.card)).not.toContain('"url"');
  });

  it('refreshes candidates from the selected site platform before rendering a drama card', async () => {
    const outputDir = await tempOutputDir();
    const runnerArgs: string[][] = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () =>
        JSON.stringify([
          { index: 0, displayIndex: 1, enName: 'Drama A', platform: 'DramaBox', commissionRate: '65%' },
          { index: 1, displayIndex: 2, enName: 'Drama B', platform: 'DramaBox', commissionRate: '50%' }
        ])
    });

    const result = await module.buildFeishuTaskSelection({
      outputDir,
      platform: 'DramaBox'
    });

    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only', '--platform', 'DramaBox']);
    expect(result.tasks.map((task) => task.index)).toEqual([0, 1]);
    expect(JSON.stringify(result.card)).toContain('选择短剧');
    expect(JSON.stringify(result.card)).toContain('Drama A');
    expect(JSON.stringify(result.card)).not.toContain('"url"');
  });

  it('exposes Feishu selection routes for platform and drama cards', async () => {
    const outputDir = await tempOutputDir();
    const app = Fastify();
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          { index: 0, displayIndex: 1, enName: 'Drama A', platform: 'MoboReels', commissionRate: '65%' }
        ])
    });
    registerInbeidouCpsRoutes(app, module);

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/feishu/select/start',
      payload: {
        outputDir,
        actionBaseUrl: 'https://n8n.example/webhook/inbeidou-select'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json().card.config.wide_screen_mode).toBe(true);
  });

  it('sends the Feishu platform card to the configured chat when requested', async () => {
    const outputDir = await tempOutputDir();
    const sentCards: Array<{ chatId: string; card: unknown; identity?: 'bot' | 'user' }> = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      dependencyProvider: {
        get: async (id) =>
          id === 'feishu_im'
            ? {
                id,
                name: 'Feishu IM',
                category: 'command_channel',
                mode: 'external',
                env: { chatId: 'oc_opctoai' }
              }
            : undefined
      },
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([{ index: 0, displayIndex: 1, enName: 'Drama A', platform: 'MoboReels', commissionRate: '65%' }]),
      feishuCardSender: async ({ chatId, card, identity }) => {
        sentCards.push({ chatId, card, identity });
        return { messageId: 'om_sent' };
      }
    });

    const result = await module.discoverForFeishu({
      outputDir,
      sendFeishu: true
    });

    expect(result.sent?.chatId).toBe('oc_opctoai');
    expect(sentCards).toHaveLength(1);
    expect(sentCards[0].identity).toBe('bot');
    expect(JSON.stringify(sentCards[0].card)).toContain('选择北斗智影平台');
  });

  it('ACKs Feishu card callback payloads immediately without opening local URLs', async () => {
    const outputDir = await tempOutputDir();
    const app = Fastify();
    const runnerArgs: string[][] = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      dependencyProvider: {
        get: async (id) =>
          id === 'feishu_im'
            ? {
                id,
                name: 'Feishu IM',
                category: 'command_channel',
                mode: 'external',
                env: { chatId: 'oc_opctoai' }
              }
            : undefined
      },
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        await new Promise(() => undefined);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () =>
        JSON.stringify([{ index: 0, displayIndex: 1, enName: 'Drama A', platform: 'DramaBox', commissionRate: '65%' }]),
      feishuCardSender: async () => ({ messageId: 'om_next' })
    });
    registerInbeidouCpsRoutes(app, module);

    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/feishu/card-action',
      payload: {
        event: {
          action: {
            value: {
              action: 'inbeidou_select_platform',
              platform: 'DramaBox',
              outputDir
            }
          }
        }
      }
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      toast: {
        type: 'info',
        content: '已收到平台选择，正在拉取短剧列表'
      }
    });
    expect(elapsedMs).toBeLessThan(500);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only', '--platform', 'DramaBox']);
  });

  it('ACKs Feishu bot menu events immediately', async () => {
    const outputDir = await tempOutputDir();
    const app = Fastify();
    const runnerArgs: string[][] = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        await new Promise(() => undefined);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () =>
        JSON.stringify([{ index: 0, displayIndex: 1, enName: 'Drama A', platform: 'DramaBox', commissionRate: '65%' }]),
      feishuCardSender: async () => ({ messageId: 'om_next' })
    });
    registerInbeidouCpsRoutes(app, module);

    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/feishu/card-action',
      payload: {
        event: {
          event_key: 'inbeidou_start_selection'
        }
      }
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      toast: {
        type: 'info',
        content: '已收到，正在检查服务并拉取平台'
      }
    });
    expect(elapsedMs).toBeLessThan(500);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only']);
  });

  it('ACKs official Feishu bot menu event subscription payloads immediately', async () => {
    const outputDir = await tempOutputDir();
    const app = Fastify();
    const runnerArgs: string[][] = [];
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        await new Promise(() => undefined);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () =>
        JSON.stringify([{ index: 0, displayIndex: 1, enName: 'Drama A', platform: 'DramaBox', commissionRate: '65%' }]),
      feishuCardSender: async () => ({ messageId: 'om_next' })
    });
    registerInbeidouCpsRoutes(app, module);

    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/feishu/menu-event',
      payload: {
        schema: '2.0',
        header: {
          event_type: 'application.bot.menu_v6',
          app_id: 'cli_test'
        },
        event: {
          event_key: 'inbeidou_start_selection',
          timestamp: 1782439720
        }
      }
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(elapsedMs).toBeLessThan(500);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only']);
  });

  it('responds to Feishu menu event URL challenge', async () => {
    const app = Fastify();
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output'
    });
    registerInbeidouCpsRoutes(app, module);

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/feishu/menu-event',
      payload: { challenge: 'menu-verify-me' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ challenge: 'menu-verify-me' });
  });

  it('responds to Feishu callback URL challenge', async () => {
    const app = Fastify();
    const module = new InbeidouCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: 'runtime/inbeidou-cps-output'
    });
    registerInbeidouCpsRoutes(app, module);

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/inbeidou/feishu/card-action',
      payload: { challenge: 'verify-me' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ challenge: 'verify-me' });
  });
});

import Fastify from 'fastify';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { MoboboostCpsModule, registerMoboboostCpsRoutes } from '../../src/appos/domains/cps/moboboost-module.js';
import type { MediaPreprocessReport } from '../../src/appos/media/preprocess.js';

const tempDirs: string[] = [];

async function tempOutputDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tele-opc-moboboost-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sampleMediaReport(inputPath: string, outputDir: string): MediaPreprocessReport {
  return {
    source: { inputPath, sha256: 'sha256' },
    probe: {
      durationSeconds: 120,
      sizeBytes: 1024,
      bitrate: 1000,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
      orientation: 'vertical',
      frameRate: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioChannels: 2,
      audioSampleRate: 44100
    },
    screenshots: [{ timeSeconds: 3, path: path.join(outputDir, 'sample.jpg') }],
    keyframes: [{ timeSeconds: 0, pictType: 'I' }],
    quality: {
      blackIntervals: [],
      blackDurationSeconds: 0,
      blackRatio: 0,
      silenceIntervals: [],
      silenceDurationSeconds: 10,
      dialogueDensity: 0.92
    },
    asr: {
      status: 'done',
      language: 'en',
      transcriptPath: path.join(outputDir, 'transcript.srt'),
      transcriptText: 'You betrayed me.',
      segments: [{ start: '00:00:00,000', end: '00:00:03,000', text: 'You betrayed me.' }]
    },
    outputs: {
      probeJsonPath: path.join(outputDir, 'ffprobe.json'),
      audioPath: path.join(outputDir, 'audio.wav'),
      blackdetectLogPath: path.join(outputDir, 'blackdetect.log'),
      silencedetectLogPath: path.join(outputDir, 'silencedetect.log'),
      reportPath: path.join(outputDir, 'media_preprocess_report.json'),
      difyPayloadPath: path.join(outputDir, 'dify_media_preprocess_payload.json')
    }
  };
}

describe('MoboBoost CPS module', () => {
  it('classifies MoboBoost original video download failure reasons from page text', () => {
    const scraperPath = path.resolve('scripts/appos/moboboost_cps_scrape.py');
    const code = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("moboboost_cps_scrape", r"${scraperPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = [
  "请先账号报备后再下载",
  "暂无权限下载原片",
  "未生成资源，请先生成推广资源",
  "download_action_not_found"
]
print(json.dumps([module.classify_download_failure(text) for text in cases], ensure_ascii=False))
`;
    const result = spawnSync('python', ['-c', code], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      ['account_report_required', '账号报备'],
      ['permission_denied', '无权限'],
      ['resource_not_generated', '未生成资源'],
      ['no_file_download', '无文件下载']
    ]);
  });

  it('keeps existing MoboBoost file records when late files are untyped', () => {
    const scraperPath = path.resolve('scripts/appos/moboboost_cps_scrape.py');
    const code = `
import importlib.util, json, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("moboboost_cps_scrape", r"${scraperPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tmp = Path(tempfile.mkdtemp())
item = {"title": "The Lost Heiress Came Back"}
late = tmp / "The Lost Heiress Came Back-第5集.mp4"
late.write_bytes(b"mp4")
downloaded = [{"kind":"episode_video_1","localPath":str(tmp / "ep1.mp4"),"sourceUrl":"","episode":1,"downloadType":"origin"}]
result = module.reconcile_expected_downloaded_files(downloaded, item, tmp, ["origin"], 1, 5)
print(json.dumps(result, ensure_ascii=False))
`;
    const result = spawnSync('python', ['-c', code], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) || '{}');
    expect(parsed.map((file: { episode: number }) => file.episode)).toEqual([1]);
  });

  it('does not reconcile untyped MoboBoost files as original videos', () => {
    const scraperPath = path.resolve('scripts/appos/moboboost_cps_scrape.py');
    const code = `
import importlib.util, json, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("moboboost_cps_scrape", r"${scraperPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tmp = Path(tempfile.mkdtemp())
item = {"title": "The Lost Heiress Came Back"}
untyped = tmp / ("The Lost Heiress Came Back-" + "\\u7b2c5\\u96c6" + ".mp4")
untyped.write_bytes(b"mp4")
result = module.reconcile_expected_downloaded_files([], item, tmp, ["origin"], 5, 5)
print(json.dumps(result, ensure_ascii=False))
`;
    const result = spawnSync('python', ['-c', code], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it('reconciles only typed origin files when origin and subtitle files coexist', () => {
    const scraperPath = path.resolve('scripts/appos/moboboost_cps_scrape.py');
    const code = `
import importlib.util, json, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("moboboost_cps_scrape", r"${scraperPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tmp = Path(tempfile.mkdtemp())
item = {"title": "The Lost Heiress Came Back"}
origin = tmp / module.moboboost_episode_filename(item, "origin", 5)
subtitle = tmp / module.moboboost_episode_filename(item, "subtitle", 5)
origin.write_bytes(b"origin")
subtitle.write_bytes(b"subtitle")
result = module.reconcile_expected_downloaded_files([], item, tmp, ["origin"], 5, 5)
print(json.dumps(result, ensure_ascii=False))
`;
    const result = spawnSync('python', ['-c', code], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) || '{}');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].downloadType).toBe('origin');
    expect(parsed[0].localPath).toContain('-origin.mp4');
  });

  it('uses the official origin download button instead of the preview video URL', () => {
    const scraperPath = path.resolve('scripts/appos/moboboost_cps_scrape.py');
    const code = `
import importlib.util, json, tempfile
from pathlib import Path
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location("moboboost_cps_scrape", r"${scraperPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tmp = Path(tempfile.mkdtemp())
calls = []
item = {"title": "The Lost Heiress Came Back", "platform": "MoboReels", "dramaId": "51447322"}
module.set_download_behavior = lambda client, download_dir: calls.append("set_download_behavior")
module.open_record_preview = lambda client, item: {"ok": True}
module.completed_download_files = lambda download_dir: []
def direct(*args, **kwargs):
    raise AssertionError("preview direct URL must not be used for origin downloads")
module.download_detail_episode_direct = direct
module.click_detail_episode_download = lambda client, episode, video_type: calls.append(f"detail:{video_type}:{episode}") or {"ok": True}
module.save_native_save_as_dialog = lambda target_path, timeout_seconds=10: False
def browser_files(client, download_dir, before_names, expected_count, timeout_seconds):
    path = Path(download_dir) / ("The Lost Heiress Came Back-" + "\\u7b2c1\\u96c6" + ".mp4")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"official-origin")
    return [path]
module.wait_for_browser_downloads = browser_files
module.visible_failure_context = lambda client: ""
args = SimpleNamespace(download_types="origin", download_start=1, download_end=1, download_timeout=1)
result = module.collect_downloaded_files(None, item, tmp, args)
print(json.dumps({"calls": calls, "result": result}, ensure_ascii=False))
`;
    const result = spawnSync('python', ['-c', code], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) || '{}');
    expect(parsed.calls).toContain('detail:origin:1');
    expect(parsed.result).toHaveLength(1);
    expect(parsed.result[0].localPath).toContain('-origin.mp4');
  });

  it('builds a browser scraper command for discover and selected platform', async () => {
    const module = new MoboboostCpsModule({
      scraperScript: 'scripts/appos/moboboost_cps_scrape.py',
      defaultOutputDir: 'runtime/moboboost-cps-output'
    });

    expect(module.buildDiscoverCommand().args).toEqual([
      'scripts/appos/moboboost_cps_scrape.py',
      '--output',
      'runtime/moboboost-cps-output',
      '--list-only'
    ]);
    expect(module.buildDiscoverCommand({ platform: 'MoboReels' }).args).toEqual([
      'scripts/appos/moboboost_cps_scrape.py',
      '--output',
      'runtime/moboboost-cps-output',
      '--list-only',
      '--platform',
      'MoboReels'
    ]);
  });

  it('discovers MoboBoost platform tabs and sends a Feishu platform card', async () => {
    const outputDir = await tempOutputDir();
    const sequence: string[] = [];
    const sentCards: unknown[] = [];
    const module = new MoboboostCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async ({ stage, requiredDependencies }) => {
        sequence.push(`ensure:${stage}:${requiredDependencies.join(',')}`);
        return { ok: true, services: requiredDependencies.map((id) => ({ id, ok: true, message: 'ok' })) };
      },
      runner: async ({ args }) => {
        sequence.push(`runner:${args.join(' ')}`);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async (filePath) => {
        if (filePath.endsWith('platform_tabs.json')) {
          return JSON.stringify([
            { index: 0, name: '全部平台' },
            { index: 1, name: 'MoboReels' },
            { index: 2, name: 'FlickReels' }
          ]);
        }
        return JSON.stringify([
          { index: 0, displayIndex: 1, title: 'Drama A', platform: 'MoboReels', commissionRate: '40%' }
        ]);
      },
      feishuCardSender: async ({ card }) => {
        sentCards.push(card);
        return { messageId: 'om_moboboost' };
      },
      dependencyProvider: {
        get: async (id) =>
          id === 'feishu_im'
            ? { id, name: 'Feishu IM', category: 'command_channel', mode: 'external', env: { chatId: 'oc_opctoai' } }
            : undefined
      }
    });

    const result = await module.discoverForFeishu({ outputDir, sendFeishu: true });

    expect(sequence[0]).toBe('ensure:discover:n8n,dify,cloakbrowser,inbeidou_profile,capcut_mate,feishu_im');
    expect(sequence[1]).toBe(`runner:scraper.py --output ${outputDir} --list-only`);
    expect(result.platforms.map((platform) => platform.name)).toEqual(['全部平台', 'MoboReels', 'FlickReels']);
    expect(JSON.stringify(result.card)).toContain('选择 MoboBoost 平台');
    expect(JSON.stringify(sentCards[0])).toContain('MoboReels');
  });

  it('refreshes dramas for the selected MoboBoost platform before rendering drama choices', async () => {
    const outputDir = await tempOutputDir();
    const runnerArgs: string[][] = [];
    const module = new MoboboostCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () =>
        JSON.stringify([
          { index: 0, displayIndex: 1, title: 'The Lost Heiress Came Back', platform: 'MoboReels', commissionRate: '40%' }
        ])
    });

    const result = await module.buildFeishuTaskSelection({ outputDir, platform: 'MoboReels' });

    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only', '--platform', 'MoboReels']);
    expect(result.tasks[0]?.title).toBe('The Lost Heiress Came Back');
    expect(JSON.stringify(result.card)).toContain('选择 MoboBoost 短剧');
    expect(JSON.stringify(result.card)).toContain('The Lost Heiress Came Back');
  });

  it('ingests selected MoboBoost drama and writes downstream payloads when requested', async () => {
    const outputDir = await tempOutputDir();
    const writtenTables: string[] = [];
    const preprocessedInputs: string[] = [];
    const module = new MoboboostCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          {
            dramaId: '51447322',
            title: 'The Lost Heiress Came Back',
            platform: 'MoboReels',
            commissionRate: '40%',
            shortDramaLink: 'https://eng.moboreels.com/VTMBi/DVET',
            originalVideoStatus: 'downloaded',
            downloadedFiles: [{ kind: 'episode_video_1', localPath: 'B:/materials/ep1.mp4', sourceUrl: '' }]
          }
        ]),
      mediaPreprocess: (options) => {
        preprocessedInputs.push(options.inputPath);
        return sampleMediaReport(options.inputPath, options.outputDir);
      },
      feishuWriter: async ({ tableName }) => {
        writtenTables.push(tableName);
      }
    });

    const result = await module.ingest({ outputDir, tasks: [0], writeFeishu: true });

    expect(result.status).toBe('done');
    expect(result.tasks[0]?.source).toBe('moboboost');
    expect(result.tasks[0]?.productId).toBe('cps_moboboost_moboreels_51447322');
    expect(result.tasks[0]?.mediaEpisodes).toHaveLength(1);
    expect(preprocessedInputs).toEqual(['B:/materials/ep1.mp4']);
    expect(writtenTables).toEqual(['CPSProducts', 'SourceMaterials', 'PublishRecords']);
  });

  it('stops before media preprocessing and Feishu writes when selected drama has no original videos', async () => {
    const outputDir = await tempOutputDir();
    const writtenTables: string[] = [];
    const preprocessedInputs: string[] = [];
    const module = new MoboboostCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      runner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      readTextFile: async () =>
        JSON.stringify([
          {
            dramaId: '51447322',
            title: 'The Lost Heiress Came Back',
            platform: 'MoboReels',
            shortDramaLink: 'https://eng.moboreels.com/VTMBi/DVET',
            originalVideoStatus: 'failed',
            originalVideoFailureCode: 'account_report_required',
            originalVideoFailureReason: '账号报备'
          }
        ]),
      mediaPreprocess: (options) => {
        preprocessedInputs.push(options.inputPath);
        return sampleMediaReport(options.inputPath, options.outputDir);
      },
      feishuWriter: async ({ tableName }) => {
        writtenTables.push(tableName);
      }
    });

    await expect(module.ingest({ outputDir, tasks: [0], writeFeishu: true })).rejects.toThrow(
      /MoboBoost original videos are required before media preprocessing.*The Lost Heiress Came Back.*账号报备/
    );
    expect(preprocessedInputs).toEqual([]);
    expect(writtenTables).toEqual([]);
  });

  it('ACKs Feishu card callbacks immediately and runs selection in the background', async () => {
    const outputDir = await tempOutputDir();
    const app = Fastify();
    const runnerArgs: string[][] = [];
    const module = new MoboboostCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        await new Promise(() => undefined);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () => JSON.stringify([]),
      feishuCardSender: async () => ({ messageId: 'om_next' })
    });
    registerMoboboostCpsRoutes(app, module);

    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/moboboost/feishu/card-action',
      payload: {
        event: {
          action: {
            value: {
              action: 'moboboost_select_platform',
              platform: 'MoboReels',
              outputDir
            }
          }
        }
      }
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ toast: { type: 'info', content: '已收到 MoboBoost 平台选择，正在拉取短剧列表' } });
    expect(elapsedMs).toBeLessThan(500);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only', '--platform', 'MoboReels']);
  });

  it('ACKs MoboBoost bot menu events and starts platform discovery', async () => {
    const outputDir = await tempOutputDir();
    const app = Fastify();
    const runnerArgs: string[][] = [];
    const module = new MoboboostCpsModule({
      scraperScript: 'scraper.py',
      defaultOutputDir: outputDir,
      ensurePrerequisites: async () => ({ ok: true, services: [{ id: 'cloakbrowser', ok: true, message: 'ok' }] }),
      runner: async ({ args }) => {
        runnerArgs.push(args);
        await new Promise(() => undefined);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
      readTextFile: async () => JSON.stringify([]),
      feishuCardSender: async () => ({ messageId: 'om_start' })
    });
    registerMoboboostCpsRoutes(app, module);

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/cps/moboboost/feishu/menu-event',
      payload: {
        schema: '2.0',
        header: { event_type: 'application.bot.menu_v6' },
        event: { event_key: 'moboboost_start_selection' }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runnerArgs[0]).toEqual(['scraper.py', '--output', outputDir, '--list-only']);
  });
});

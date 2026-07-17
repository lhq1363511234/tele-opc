import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { DependencyRegistry, type AppDependency } from '../../dependencies/registry.js';
import { resolveFeishuTableId } from '../../feishu/base-tables.js';
import { ensureCloakBrowserProfileReady } from './cloakbrowser-prerequisites.js';
import {
  buildMoboboostDifyPayload,
  buildMoboboostFeishuBatchPayloads,
  normalizeMoboboostResults,
  type MoboboostRawTask,
  type NormalizedMoboboostTask
} from './moboboost.js';
import { collectMoboboostEpisodeVideos, enrichMoboboostTaskWithMedia } from './moboboost-media.js';
import type { MediaPreprocessOptions, MediaPreprocessReport } from '../../media/preprocess.js';

type RunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandRunner = (input: { command: string; args: string[]; env: NodeJS.ProcessEnv }) => Promise<RunnerResult>;
type TextFileReader = (filePath: string) => Promise<string>;
type MediaPreprocessRunner = (options: MediaPreprocessOptions) => MediaPreprocessReport;
type FeishuWriter = (input: { tableName: string; payload: { fields: string[]; rows: unknown[][] } }) => Promise<void>;
type DifyTrigger = (input: { payload: ReturnType<typeof buildMoboboostDifyPayload> }) => Promise<void>;
type FeishuCardSender = (input: {
  chatId: string;
  card: unknown;
  identity?: 'bot' | 'user';
}) => Promise<{ messageId?: string; raw?: unknown }>;
type DependencyProvider = { get: (id: string) => Promise<AppDependency | undefined> };
type PrerequisiteEnsurer = (input: {
  stage: 'discover' | 'ingest';
  requiredDependencies: string[];
}) => Promise<PrerequisiteResult>;

type PrerequisiteResult = {
  ok: boolean;
  services: Array<{ id: string; ok: boolean; message: string; status?: number }>;
};

type MoboboostTaskCandidate = MoboboostRawTask & {
  index: number;
  displayIndex?: number;
  title?: string;
  platform?: string;
  commissionRate?: string;
};

type MoboboostPlatformTab = {
  index?: number;
  name: string;
};

export type MoboboostCpsIngestInput = {
  all?: boolean;
  tasks?: number[];
  outputDir?: string;
  platform?: string;
  noDownload?: boolean;
  preprocessMedia?: boolean;
  mediaLanguage?: string;
  downloadTypes?: 'origin' | 'subtitle' | 'both';
  downloadStart?: number;
  downloadEnd?: number;
  writeFeishu?: boolean;
  triggerDify?: boolean;
  editBriefPath?: string;
};

export type MoboboostFeishuDiscoverInput = {
  outputDir?: string;
  actionBaseUrl?: string;
  requiredDependencies?: string[];
  sendFeishu?: boolean;
  chatId?: string;
};

export type MoboboostFeishuTaskSelectionInput = {
  outputDir?: string;
  platform: string;
  actionBaseUrl?: string;
  sendFeishu?: boolean;
  chatId?: string;
};

export type MoboboostScrapeCommand = {
  command: 'python';
  args: string[];
  env: NodeJS.ProcessEnv;
  outputDir: string;
  resultPath: string;
};

export type MoboboostCpsModuleOptions = {
  scraperScript: string;
  defaultOutputDir: string;
  editBriefPath?: string;
  runner?: CommandRunner;
  readTextFile?: TextFileReader;
  feishuWriter?: FeishuWriter;
  feishuCardSender?: FeishuCardSender;
  difyTrigger?: DifyTrigger;
  mediaPreprocess?: MediaPreprocessRunner;
  dependencyProvider?: DependencyProvider;
  ensurePrerequisites?: PrerequisiteEnsurer;
};

const taskIndexSchema = z.number().int().min(0);

const routeBodySchema = z
  .object({
    all: z.boolean().optional(),
    tasks: z.array(taskIndexSchema).optional(),
    outputDir: z.string().min(1).optional(),
    output_dir: z.string().min(1).optional(),
    platform: z.string().min(1).optional(),
    noDownload: z.boolean().optional(),
    no_download: z.boolean().optional(),
    preprocessMedia: z.boolean().optional(),
    preprocess_media: z.boolean().optional(),
    mediaLanguage: z.string().min(1).optional(),
    media_language: z.string().min(1).optional(),
    downloadTypes: z.enum(['origin', 'subtitle', 'both']).optional(),
    download_types: z.enum(['origin', 'subtitle', 'both']).optional(),
    downloadStart: z.number().int().min(1).optional(),
    download_start: z.number().int().min(1).optional(),
    downloadEnd: z.number().int().min(1).optional(),
    download_end: z.number().int().min(1).optional(),
    writeFeishu: z.boolean().optional(),
    write_feishu: z.boolean().optional(),
    triggerDify: z.boolean().optional(),
    trigger_dify: z.boolean().optional(),
    editBriefPath: z.string().min(1).optional(),
    edit_brief_path: z.string().min(1).optional()
  })
  .strict();

const feishuDiscoverBodySchema = z
  .object({
    outputDir: z.string().min(1).optional(),
    output_dir: z.string().min(1).optional(),
    actionBaseUrl: z.string().min(1).optional(),
    action_base_url: z.string().min(1).optional(),
    requiredDependencies: z.array(z.string().min(1)).optional(),
    required_dependencies: z.array(z.string().min(1)).optional(),
    sendFeishu: z.boolean().optional(),
    send_feishu: z.boolean().optional(),
    chatId: z.string().min(1).optional(),
    chat_id: z.string().min(1).optional()
  })
  .strict();

const feishuTaskSelectionBodySchema = z
  .object({
    outputDir: z.string().min(1).optional(),
    output_dir: z.string().min(1).optional(),
    platform: z.string().min(1),
    actionBaseUrl: z.string().min(1).optional(),
    action_base_url: z.string().min(1).optional(),
    sendFeishu: z.boolean().optional(),
    send_feishu: z.boolean().optional(),
    chatId: z.string().min(1).optional(),
    chat_id: z.string().min(1).optional()
  })
  .strict();

const feishuTaskRunBodySchema = z
  .object({
    outputDir: z.string().min(1).optional(),
    output_dir: z.string().min(1).optional(),
    taskIndex: taskIndexSchema.optional(),
    task_index: taskIndexSchema.optional(),
    platform: z.string().min(1).optional(),
    preprocessMedia: z.boolean().optional(),
    preprocess_media: z.boolean().optional(),
    mediaLanguage: z.string().min(1).optional(),
    media_language: z.string().min(1).optional(),
    downloadTypes: z.enum(['origin', 'subtitle', 'both']).optional(),
    download_types: z.enum(['origin', 'subtitle', 'both']).optional(),
    downloadStart: z.number().int().min(1).optional(),
    download_start: z.number().int().min(1).optional(),
    downloadEnd: z.number().int().min(1).optional(),
    download_end: z.number().int().min(1).optional(),
    writeFeishu: z.boolean().optional(),
    write_feishu: z.boolean().optional(),
    triggerDify: z.boolean().optional(),
    trigger_dify: z.boolean().optional()
  })
  .strict();

const feishuCardActionBodySchema = z
  .object({
    challenge: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    platform: z.string().min(1).optional(),
    outputDir: z.string().min(1).optional(),
    output_dir: z.string().min(1).optional(),
    taskIndex: taskIndexSchema.optional(),
    task_index: taskIndexSchema.optional(),
    value: z.record(z.unknown()).optional()
  })
  .passthrough();

const DEFAULT_MOBOBOOST_DEPENDENCIES = ['n8n', 'dify', 'cloakbrowser', 'inbeidou_profile', 'capcut_mate', 'feishu_im'];

const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultRunner: CommandRunner = ({ command, args, env }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });

const defaultFeishuCardSender: FeishuCardSender = async ({ chatId, card, identity = 'bot' }) => {
  const cliPath = process.platform === 'win32' ? `${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js` : '';
  const command = process.platform === 'win32' ? 'node' : 'lark-cli';
  const args = [
    ...(process.platform === 'win32' ? [cliPath] : []),
    'im',
    'messages',
    'send',
    '--as',
    identity,
    '--chat-id',
    chatId,
    '--msg-type',
    'interactive',
    '--content',
    JSON.stringify(card),
    '--format',
    'json'
  ];
  const result = await defaultRunner({ command, args, env: process.env });
  if (result.exitCode !== 0) {
    throw new Error(`Feishu card send failed: ${result.stderr || result.stdout}`);
  }
  const raw = result.stdout ? (JSON.parse(result.stdout) as unknown) : {};
  const messageId =
    raw && typeof raw === 'object' && 'data' in raw ? (raw as { data?: { message_id?: string } }).data?.message_id : undefined;
  return { messageId, raw };
};

async function testDependency(dependency: AppDependency) {
  const url = dependency.healthCheckUrl || dependency.baseUrl;
  if (!url) return { ok: true, message: 'no health url configured' };
  try {
    const response = await fetch(url);
    return { ok: response.ok, status: response.status, message: response.ok ? 'ok' : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForDependency(dependency: AppDependency) {
  let latest = await testDependency(dependency);
  for (let index = 0; index < 20 && !latest.ok; index += 1) {
    await sleep(1000);
    latest = await testDependency(dependency);
  }
  return latest;
}

async function ensureMoboboostWorkflowServicesReady(input: {
  requiredDependencies: string[];
  dependencyProvider?: DependencyProvider;
}): Promise<PrerequisiteResult> {
  const registry = input.dependencyProvider ?? new DependencyRegistry();
  const services: PrerequisiteResult['services'] = [];
  let cloakbrowserReady: Awaited<ReturnType<typeof ensureCloakBrowserProfileReady>> | undefined;

  for (const id of input.requiredDependencies) {
    if (id === 'cloakbrowser' || id === 'inbeidou_profile') {
      try {
        cloakbrowserReady = cloakbrowserReady ?? (await ensureCloakBrowserProfileReady({ dependencyProvider: registry }));
        const message =
          id === 'cloakbrowser'
            ? `manager=${cloakbrowserReady.baseUrl}`
            : `profile=${cloakbrowserReady.profileId}; cdp=${cloakbrowserReady.cdpReady ? 'ready' : 'not_ready'}`;
        services.push({ id, ok: true, message });
      } catch (error) {
        services.push({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }

    if (id === 'feishu_im') {
      const dependency = await registry.get('feishu_im');
      const chatId = dependency?.env?.chatId ?? process.env.APPOS_FEISHU_CPS_CHAT_ID;
      services.push({ id, ok: Boolean(chatId), message: chatId ? `chat=${chatId}` : 'missing feishu_im.env.chatId' });
      continue;
    }

    const dependency = await registry.get(id);
    if (!dependency || dependency.mode === 'disabled') {
      services.push({ id, ok: false, message: dependency ? 'disabled' : 'missing dependency config' });
      continue;
    }

    let status = await testDependency(dependency);
    if (!status.ok && dependency.mode === 'managed' && dependency.startCommand) {
      if ('start' in registry && typeof registry.start === 'function') {
        await registry.start(id);
      } else {
        services.push({ id, ok: false, message: `${status.message}; cannot auto-start with this dependency provider`, status: status.status });
        continue;
      }
      status = await waitForDependency(dependency);
    }
    services.push({ id, ok: status.ok, message: status.message, status: status.status });
  }

  return { ok: services.every((service) => service.ok), services };
}

function parseCandidateList(raw: string): MoboboostTaskCandidate[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('MoboBoost task candidate file must be a JSON array');
  }
  return parsed.map((item, index) => {
    const candidate = item as MoboboostTaskCandidate;
    return {
      ...candidate,
      index: Number.isInteger(candidate.index) ? candidate.index : index
    };
  });
}

function parsePlatformTabs(raw: string): MoboboostPlatformTab[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('MoboBoost platform tab file must be a JSON array');
  }
  return parsed.flatMap((item, index) => {
    if (typeof item === 'string') return item.trim() ? [{ index, name: item.trim() }] : [];
    if (item && typeof item === 'object' && 'name' in item) {
      const tab = item as MoboboostPlatformTab;
      return tab.name?.trim() ? [{ ...tab, index: tab.index ?? index, name: tab.name.trim() }] : [];
    }
    return [];
  });
}

function isAllPlatform(platform: string) {
  const normalized = platform.trim().toLowerCase();
  return normalized === 'all' || normalized === '全部平台' || normalized === '全部';
}

function originalVideoFailureReason(task: NormalizedMoboboostTask) {
  if (task.originalVideoFailureReason) return task.originalVideoFailureReason;
  if (task.originalVideoFailureCode) return task.originalVideoFailureCode;
  if (task.originalVideoStatus && task.originalVideoStatus !== 'downloaded') return task.originalVideoStatus;
  return '无文件下载';
}

function assertMoboboostOriginalVideosReady(tasks: NormalizedMoboboostTask[]) {
  const missing = tasks.filter((task) => collectMoboboostEpisodeVideos(task).length === 0);
  if (missing.length === 0) return;
  const details = missing
    .map((task) => `${task.name || task.taskId}(${task.taskId}): ${originalVideoFailureReason(task)}`)
    .join('; ');
  throw new Error(`MoboBoost original videos are required before media preprocessing, Feishu write, or Dify trigger: ${details}`);
}

function feishuButton(input: { text: string; value: Record<string, unknown>; actionBaseUrl?: string }) {
  const encoded = new URLSearchParams(
    Object.fromEntries(Object.entries(input.value).map(([key, value]) => [key, String(value)]))
  ).toString();
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: input.text },
    type: 'primary',
    ...(input.actionBaseUrl ? { url: `${input.actionBaseUrl}${input.actionBaseUrl.includes('?') ? '&' : '?'}${encoded}` } : {}),
    value: input.value
  };
}

function renderFeishuPlatformSelectionCard(input: {
  outputDir: string;
  platforms: Array<{ name: string; count: number }>;
  actionBaseUrl?: string;
  prerequisites: PrerequisiteResult;
}) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            '**选择 MoboBoost 平台**',
            `依赖检查：${input.prerequisites.services.map((service) => `${service.id}:${service.ok ? 'ok' : 'fail'}`).join(' / ')}`,
            `候选平台：${input.platforms.length} 个`
          ].join('\n')
        }
      },
      ...input.platforms.map((platform) => ({
        tag: 'action',
        actions: [
          feishuButton({
            text: platform.name,
            actionBaseUrl: input.actionBaseUrl,
            value: {
              action: 'moboboost_select_platform',
              platform: platform.name,
              outputDir: input.outputDir
            }
          })
        ]
      }))
    ]
  };
}

function renderFeishuTaskSelectionCard(input: {
  outputDir: string;
  platform: string;
  tasks: MoboboostTaskCandidate[];
  actionBaseUrl?: string;
}) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**选择 MoboBoost 短剧**\n平台：${input.platform}\n候选短剧：${input.tasks.length} 部`
        }
      },
      ...input.tasks.map((task) => ({
        tag: 'action',
        actions: [
          feishuButton({
            text: `#${task.displayIndex ?? task.index + 1} ${task.title || task.enName || task.chName || '未命名短剧'} ${
              task.commissionRate ? `/${task.commissionRate}` : ''
            }`,
            actionBaseUrl: input.actionBaseUrl,
            value: {
              action: 'moboboost_select_task',
              taskIndex: task.index,
              outputDir: input.outputDir,
              platform: input.platform
            }
          })
        ]
      }))
    ]
  };
}

export class MoboboostCpsModule {
  private readonly scraperScript: string;
  private readonly defaultOutputDir: string;
  private readonly editBriefPath: string;
  private readonly runner: CommandRunner;
  private readonly readTextFile: TextFileReader;
  private readonly feishuWriter?: FeishuWriter;
  private readonly feishuCardSender: FeishuCardSender;
  private readonly difyTrigger?: DifyTrigger;
  private readonly mediaPreprocess?: MediaPreprocessRunner;
  private readonly dependencyProvider?: DependencyProvider;
  private readonly ensurePrerequisites: PrerequisiteEnsurer;

  constructor(options: MoboboostCpsModuleOptions) {
    this.scraperScript = options.scraperScript;
    this.defaultOutputDir = options.defaultOutputDir;
    this.editBriefPath = options.editBriefPath ?? '';
    this.runner = options.runner ?? defaultRunner;
    this.readTextFile = options.readTextFile ?? ((filePath) => readFile(filePath, 'utf8'));
    this.feishuWriter = options.feishuWriter;
    this.feishuCardSender = options.feishuCardSender ?? defaultFeishuCardSender;
    this.difyTrigger = options.difyTrigger;
    this.mediaPreprocess = options.mediaPreprocess;
    this.dependencyProvider = options.dependencyProvider;
    this.ensurePrerequisites = options.ensurePrerequisites ?? (async () => ({ ok: true, services: [] }));
  }

  static fromEnv() {
    const dependencyProvider = new DependencyRegistry();
    return new MoboboostCpsModule({
      scraperScript: process.env.MOBOBOOST_CPS_SCRAPER_SCRIPT ?? path.join('scripts', 'appos', 'moboboost_cps_scrape.py'),
      defaultOutputDir: process.env.MOBOBOOST_CPS_OUTPUT_DIR ?? path.join('runtime', 'moboboost-cps-output'),
      editBriefPath: process.env.CPS_EDIT_BRIEF_PATH,
      dependencyProvider,
      ensurePrerequisites: ({ requiredDependencies }) =>
        ensureMoboboostWorkflowServicesReady({ requiredDependencies, dependencyProvider })
    });
  }

  buildScrapeCommand(input: MoboboostCpsIngestInput = {}): MoboboostScrapeCommand {
    const outputDir = input.outputDir ?? this.defaultOutputDir;
    const tasks = input.tasks ?? [0];
    for (const task of tasks) {
      if (!Number.isInteger(task) || task < 0) {
        throw new Error('tasks must be non-negative integers');
      }
    }

    const args = [this.scraperScript, '--output', outputDir];
    if (input.all) {
      args.push('--all');
    } else {
      args.push('--tasks', ...tasks.map(String));
    }
    if (input.platform && !isAllPlatform(input.platform)) {
      args.push('--platform', input.platform);
    }
    if (input.noDownload) args.push('--no-download');
    if (input.downloadTypes) args.push('--download-types', input.downloadTypes);
    if (input.downloadStart) args.push('--download-start', String(input.downloadStart));
    if (input.downloadEnd) args.push('--download-end', String(input.downloadEnd));

    return {
      command: 'python',
      args,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
        CPS_OUTPUT_DIR: outputDir
      },
      outputDir,
      resultPath: path.join(outputDir, 'cps_results.json')
    };
  }

  buildDiscoverCommand(input: MoboboostFeishuDiscoverInput & { platform?: string } = {}): MoboboostScrapeCommand {
    const outputDir = input.outputDir ?? this.defaultOutputDir;
    const args = [this.scraperScript, '--output', outputDir, '--list-only'];
    if (input.platform && !isAllPlatform(input.platform)) {
      args.push('--platform', input.platform);
    }
    return {
      command: 'python',
      args,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
        CPS_OUTPUT_DIR: outputDir
      },
      outputDir,
      resultPath: path.join(outputDir, 'task_candidates.json')
    };
  }

  async discoverForFeishu(input: MoboboostFeishuDiscoverInput = {}) {
    const requiredDependencies = input.requiredDependencies ?? DEFAULT_MOBOBOOST_DEPENDENCIES;
    const prerequisites = await this.ensurePrerequisites({ stage: 'discover', requiredDependencies });
    if (!prerequisites.ok) {
      throw new Error(`MoboBoost workflow dependencies are not ready: ${prerequisites.services.map((s) => `${s.id}=${s.message}`).join('; ')}`);
    }

    const command = this.buildDiscoverCommand(input);
    command.env = await this.withRuntimeScraperEnv(command.env, command.outputDir);
    const scrape = await this.runner(command);
    if (scrape.exitCode !== 0) {
      throw new Error(`MoboBoost discover failed with exit code ${scrape.exitCode}: ${scrape.stderr || scrape.stdout}`);
    }

    const candidates = parseCandidateList(await this.readTextFile(command.resultPath));
    let platforms: Array<{ name: string; count: number }>;
    try {
      platforms = parsePlatformTabs(await this.readTextFile(path.join(command.outputDir, 'platform_tabs.json'))).map((platform) => ({
        name: platform.name,
        count: 0
      }));
    } catch {
      platforms = [...new Set(candidates.map((candidate) => candidate.platform || 'MoboBoost'))].map((name) => ({ name, count: 0 }));
    }
    const card = renderFeishuPlatformSelectionCard({
      outputDir: command.outputDir,
      platforms,
      actionBaseUrl: input.actionBaseUrl,
      prerequisites
    });
    const sent = input.sendFeishu ? await this.sendFeishuCard(card, input.chatId) : undefined;
    return {
      status: 'ready_for_platform_selection' as const,
      outputDir: command.outputDir,
      candidates,
      platforms,
      prerequisites,
      scraper: {
        command: command.command,
        args: command.args,
        stdout: scrape.stdout,
        stderr: scrape.stderr
      },
      card,
      sent
    };
  }

  async buildFeishuTaskSelection(input: MoboboostFeishuTaskSelectionInput) {
    const outputDir = input.outputDir ?? this.defaultOutputDir;
    const prerequisites = await this.ensurePrerequisites({
      stage: 'discover',
      requiredDependencies: DEFAULT_MOBOBOOST_DEPENDENCIES
    });
    if (!prerequisites.ok) {
      throw new Error(`MoboBoost workflow dependencies are not ready: ${prerequisites.services.map((s) => `${s.id}=${s.message}`).join('; ')}`);
    }
    const command = this.buildDiscoverCommand({ outputDir, platform: input.platform });
    command.env = await this.withRuntimeScraperEnv(command.env, command.outputDir);
    const scrape = await this.runner(command);
    if (scrape.exitCode !== 0) {
      throw new Error(`MoboBoost platform discover failed with exit code ${scrape.exitCode}: ${scrape.stderr || scrape.stdout}`);
    }
    const tasks = parseCandidateList(await this.readTextFile(command.resultPath));
    const card = renderFeishuTaskSelectionCard({
      outputDir,
      platform: input.platform,
      tasks,
      actionBaseUrl: input.actionBaseUrl
    });
    const sent = input.sendFeishu ? await this.sendFeishuCard(card, input.chatId) : undefined;
    return {
      status: 'ready_for_task_selection' as const,
      outputDir,
      platform: input.platform,
      tasks,
      card,
      sent
    };
  }

  async ingest(input: MoboboostCpsIngestInput = {}) {
    const prerequisites = await this.ensurePrerequisites({
      stage: 'ingest',
      requiredDependencies: DEFAULT_MOBOBOOST_DEPENDENCIES
    });
    if (!prerequisites.ok) {
      throw new Error(`MoboBoost workflow dependencies are not ready: ${prerequisites.services.map((s) => `${s.id}=${s.message}`).join('; ')}`);
    }
    const command = this.buildScrapeCommand(input);
    command.env = await this.withRuntimeScraperEnv(command.env, command.outputDir);
    const scrape = await this.runner(command);
    if (scrape.exitCode !== 0) {
      throw new Error(`MoboBoost scraper failed with exit code ${scrape.exitCode}: ${scrape.stderr || scrape.stdout}`);
    }

    const rawResults = JSON.parse(await this.readTextFile(command.resultPath)) as unknown;
    if (!Array.isArray(rawResults)) {
      throw new Error(`MoboBoost scraper result must be a JSON array: ${command.resultPath}`);
    }

    const normalizedTasks = normalizeMoboboostResults(rawResults as MoboboostRawTask[]);
    const shouldPreprocessMedia = input.preprocessMedia === true || input.writeFeishu === true || input.triggerDify === true || Boolean(this.mediaPreprocess);
    if (shouldPreprocessMedia) {
      assertMoboboostOriginalVideosReady(normalizedTasks);
    }
    const tasks = shouldPreprocessMedia
      ? normalizedTasks.map((task) =>
          enrichMoboboostTaskWithMedia(task, {
            outputDir: path.join(command.outputDir, 'media-analysis'),
            language: input.mediaLanguage ?? process.env.CPS_MEDIA_LANGUAGE ?? task.language ?? 'en',
            whisperModelPath: process.env.APPOS_WHISPER_MODEL_PATH || undefined,
            whisperCliPath: process.env.APPOS_WHISPER_CLI_PATH || undefined,
            whisperCliModel: process.env.APPOS_WHISPER_CLI_MODEL || undefined,
            whisperCliTimeoutMs: Number(process.env.APPOS_WHISPER_CLI_TIMEOUT_MS || 900000),
            preprocess: this.mediaPreprocess
          })
        )
      : normalizedTasks;
    const feishuPayloads = buildMoboboostFeishuBatchPayloads(tasks);
    const difyPayload = buildMoboboostDifyPayload(tasks, {
      operator: 'opctoai',
      editBriefPath: input.editBriefPath ?? this.editBriefPath
    });
    const feishuWrites: Array<{ tableName: string; rowCount: number }> = [];
    if (input.writeFeishu) {
      for (const [tableName, payload] of Object.entries(feishuPayloads)) {
        if (payload.rows.length === 0) continue;
        await this.writeFeishuTable(tableName, payload);
        feishuWrites.push({ tableName, rowCount: payload.rows.length });
      }
    }
    let difyTriggered = false;
    if (input.triggerDify) {
      await this.triggerDifyWorkflow(difyPayload);
      difyTriggered = true;
    }

    return {
      status: 'done' as const,
      outputDir: command.outputDir,
      resultPath: command.resultPath,
      scraper: {
        command: command.command,
        args: command.args,
        stdout: scrape.stdout,
        stderr: scrape.stderr
      },
      tasks,
      feishuPayloads,
      difyPayload,
      downstream: {
        writeFeishuRequested: input.writeFeishu === true,
        triggerDifyRequested: input.triggerDify === true,
        feishuWrites,
        difyTriggered
      }
    };
  }

  private async withRuntimeScraperEnv(env: NodeJS.ProcessEnv, outputDir: string) {
    const [manager, profile] = await Promise.all([
      this.dependencyProvider?.get('cloakbrowser'),
      this.dependencyProvider?.get('inbeidou_profile')
    ]);
    return {
      ...env,
      PYTHONIOENCODING: env.PYTHONIOENCODING || 'utf-8',
      CPS_OUTPUT_DIR: outputDir,
      MOBOBOOST_ENTRY_URL: process.env.MOBOBOOST_ENTRY_URL ?? 'https://ckoc.cdreader.com/cn/material/content/v2/center',
      MOBOBOOST_FALLBACK_URL:
        process.env.MOBOBOOST_FALLBACK_URL ?? 'https://mckoc.cdreader.com/#/home?invCode=M939405',
      ...(manager?.baseUrl ? { CLOAKBROWSER_MANAGER: manager.baseUrl } : {}),
      ...(profile?.env?.profileId ? { CLOAKBROWSER_PROFILE: profile.env.profileId } : {})
    };
  }

  private async sendFeishuCard(card: unknown, requestedChatId?: string) {
    const feishuIm = await this.dependencyProvider?.get('feishu_im');
    const chatId = requestedChatId ?? feishuIm?.env?.chatId ?? process.env.APPOS_FEISHU_CPS_CHAT_ID;
    if (!chatId) {
      throw new Error('Missing Feishu chat id. Configure feishu_im.env.chatId or pass chatId.');
    }
    const configuredIdentity = feishuIm?.env?.sendIdentity ?? process.env.APPOS_FEISHU_SEND_IDENTITY ?? 'bot';
    const identity = configuredIdentity === 'user' ? 'user' : 'bot';
    const result = await this.feishuCardSender({ chatId, card, identity });
    return { chatId, ...result };
  }

  private async writeFeishuTable(tableName: string, payload: { fields: string[]; rows: unknown[][] }) {
    if (this.feishuWriter) {
      await this.feishuWriter({ tableName, payload });
      return;
    }

    const baseToken = process.env.APPOS_FEISHU_BASE_APP_TOKEN;
    if (!baseToken) {
      throw new Error('APPOS_FEISHU_BASE_APP_TOKEN is required to write Feishu Base rows');
    }
    const tableId = resolveFeishuTableId(tableName);
    const command = process.platform === 'win32' ? 'node' : 'lark-cli';
    const prefixArgs =
      process.platform === 'win32' ? [`${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js`] : [];
    const result = await this.runner({
      command,
      args: [
        ...prefixArgs,
        'base',
        '+record-batch-create',
        '--base-token',
        baseToken,
        '--table-id',
        tableId,
        '--json',
        JSON.stringify(payload)
      ],
      env: process.env
    });
    if (result.exitCode !== 0) {
      throw new Error(`Feishu Base write failed for ${tableName}: ${result.stderr || result.stdout}`);
    }
  }

  private async triggerDifyWorkflow(payload: ReturnType<typeof buildMoboboostDifyPayload>) {
    if (this.difyTrigger) {
      await this.difyTrigger({ payload });
      return;
    }
    const webhookUrl = process.env.APPOS_DIFY_MOBOBOOST_WEBHOOK_URL ?? process.env.APPOS_DIFY_INBEIDOU_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('APPOS_DIFY_MOBOBOOST_WEBHOOK_URL is required to trigger Dify');
    }
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Dify webhook failed: ${response.status} ${await response.text()}`);
    }
  }
}

function normalizeRouteBody(payload: unknown): MoboboostCpsIngestInput {
  const body = routeBodySchema.parse(payload);
  return {
    all: body.all,
    tasks: body.tasks,
    outputDir: body.outputDir ?? body.output_dir,
    platform: body.platform,
    noDownload: body.noDownload ?? body.no_download,
    preprocessMedia: body.preprocessMedia ?? body.preprocess_media,
    mediaLanguage: body.mediaLanguage ?? body.media_language,
    downloadTypes: body.downloadTypes ?? body.download_types,
    downloadStart: body.downloadStart ?? body.download_start,
    downloadEnd: body.downloadEnd ?? body.download_end,
    writeFeishu: body.writeFeishu ?? body.write_feishu,
    triggerDify: body.triggerDify ?? body.trigger_dify,
    editBriefPath: body.editBriefPath ?? body.edit_brief_path
  };
}

function normalizeFeishuDiscoverBody(payload: unknown): MoboboostFeishuDiscoverInput {
  const body = feishuDiscoverBodySchema.parse(payload ?? {});
  return {
    outputDir: body.outputDir ?? body.output_dir,
    actionBaseUrl: body.actionBaseUrl ?? body.action_base_url,
    requiredDependencies: body.requiredDependencies ?? body.required_dependencies,
    sendFeishu: body.sendFeishu ?? body.send_feishu,
    chatId: body.chatId ?? body.chat_id
  };
}

function normalizeFeishuTaskSelectionBody(payload: unknown): MoboboostFeishuTaskSelectionInput {
  const body = feishuTaskSelectionBodySchema.parse(payload);
  return {
    outputDir: body.outputDir ?? body.output_dir,
    platform: body.platform,
    actionBaseUrl: body.actionBaseUrl ?? body.action_base_url,
    sendFeishu: body.sendFeishu ?? body.send_feishu,
    chatId: body.chatId ?? body.chat_id
  };
}

function normalizeFeishuTaskRunBody(payload: unknown): MoboboostCpsIngestInput {
  const body = feishuTaskRunBodySchema.parse(payload);
  const taskIndex = body.taskIndex ?? body.task_index;
  if (!Number.isInteger(taskIndex) || taskIndex === undefined || taskIndex < 0) {
    throw new Error('taskIndex is required');
  }
  return {
    outputDir: body.outputDir ?? body.output_dir,
    platform: body.platform,
    tasks: [taskIndex],
    preprocessMedia: body.preprocessMedia ?? body.preprocess_media,
    mediaLanguage: body.mediaLanguage ?? body.media_language,
    downloadTypes: body.downloadTypes ?? body.download_types,
    downloadStart: body.downloadStart ?? body.download_start,
    downloadEnd: body.downloadEnd ?? body.download_end,
    writeFeishu: body.writeFeishu ?? body.write_feishu,
    triggerDify: body.triggerDify ?? body.trigger_dify
  };
}

function readRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}

function normalizeFeishuCardActionBody(payload: unknown) {
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const nestedEvent = raw.event && typeof raw.event === 'object' ? (raw.event as Record<string, unknown>) : {};
  const nestedAction = nestedEvent.action && typeof nestedEvent.action === 'object' ? (nestedEvent.action as Record<string, unknown>) : {};
  const nestedValue =
    nestedAction.value && typeof nestedAction.value === 'object' ? (nestedAction.value as Record<string, unknown>) : {};
  const body = feishuCardActionBodySchema.parse({
    ...raw,
    ...nestedValue,
    action: readRecordValue(raw, 'action') ?? readRecordValue(nestedValue, 'action') ?? readRecordValue(nestedEvent, 'event_key'),
    platform: readRecordValue(raw, 'platform') ?? readRecordValue(nestedValue, 'platform'),
    outputDir: readRecordValue(raw, 'outputDir') ?? readRecordValue(raw, 'output_dir') ?? readRecordValue(nestedValue, 'outputDir'),
    taskIndex: readRecordValue(raw, 'taskIndex') ?? readRecordValue(raw, 'task_index') ?? readRecordValue(nestedValue, 'taskIndex'),
    challenge: readRecordValue(raw, 'challenge')
  });
  return {
    action: body.action,
    platform: body.platform,
    outputDir: body.outputDir ?? body.output_dir,
    taskIndex: body.taskIndex ?? body.task_index,
    challenge: body.challenge
  };
}

function feishuCardToast(content: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  return {
    toast: {
      type,
      content
    }
  };
}

export function registerMoboboostCpsRoutes(
  app: FastifyInstance<any, any, any, any>,
  module: MoboboostCpsModule = MoboboostCpsModule.fromEnv()
) {
  const runFeishuSelectionAction = async (action: ReturnType<typeof normalizeFeishuCardActionBody>) => {
    if (action.action === 'moboboost_start_selection' || action.action === 'moboboost_select_start') {
      await module.discoverForFeishu({
        outputDir: action.outputDir,
        sendFeishu: true
      });
      return;
    }
    if (action.action === 'moboboost_select_platform') {
      if (!action.platform) throw new Error('platform is required');
      await module.buildFeishuTaskSelection({
        outputDir: action.outputDir,
        platform: action.platform,
        sendFeishu: true
      });
      return;
    }
    if (action.action === 'moboboost_select_task') {
      const taskIndex = action.taskIndex;
      if (!Number.isInteger(taskIndex) || taskIndex === undefined || taskIndex < 0) {
        throw new Error('taskIndex is required');
      }
      await module.ingest({
        outputDir: action.outputDir,
        platform: action.platform,
        tasks: [taskIndex],
        preprocessMedia: true,
        mediaLanguage: 'en',
        downloadTypes: 'origin',
        writeFeishu: true,
        triggerDify: false
      });
      return;
    }
    throw new Error(`unsupported card action: ${action.action ?? '<empty>'}`);
  };

  app.post('/api/appos/cps/moboboost/ingest', async (request, reply) => {
    try {
      const result = await module.ingest(normalizeRouteBody(request.body));
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/appos/cps/moboboost/feishu/select/start', async (request, reply) => {
    try {
      const result = await module.discoverForFeishu(normalizeFeishuDiscoverBody(request.body));
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/appos/cps/moboboost/feishu/select/platform', async (request, reply) => {
    try {
      const result = await module.buildFeishuTaskSelection(normalizeFeishuTaskSelectionBody(request.body));
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/appos/cps/moboboost/feishu/select/task', async (request, reply) => {
    try {
      const result = await module.ingest(normalizeFeishuTaskRunBody(request.body));
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('taskIndex is required') || message.includes('tasks must be non-negative integers')) {
        reply.code(400);
        return { ok: false, error: message };
      }
      reply.code(500);
      return { ok: false, error: message };
    }
  });

  app.post('/api/appos/cps/moboboost/feishu/card-action', async (request) => {
    try {
      const action = normalizeFeishuCardActionBody(request.body);
      if (action.challenge) return { challenge: action.challenge };

      void runFeishuSelectionAction(action).catch((error) => {
        request.log.error({ err: error, action: action.action, platform: action.platform, taskIndex: action.taskIndex }, 'MoboBoost card action failed');
      });

      if (action.action === 'moboboost_select_platform') {
        return feishuCardToast('已收到 MoboBoost 平台选择，正在拉取短剧列表');
      }
      if (action.action === 'moboboost_select_task') {
        return feishuCardToast('已收到 MoboBoost 选剧请求，正在采集素材并写入流程');
      }
      if (action.action === 'moboboost_start_selection' || action.action === 'moboboost_select_start') {
        return feishuCardToast('已收到，正在检查服务并拉取 MoboBoost 平台');
      }
      return feishuCardToast('未识别的 MoboBoost 操作，已记录日志', 'warning');
    } catch (error) {
      if (error instanceof ZodError) {
        return feishuCardToast(`卡片参数错误：${formatZodError(error)}`, 'warning');
      }
      request.log.error({ err: error }, 'MoboBoost card action parse failed');
      return feishuCardToast('MoboBoost 卡片回调处理失败，已记录日志', 'error');
    }
  });

  app.post('/api/appos/cps/moboboost/feishu/menu-event', async (request) => {
    try {
      const action = normalizeFeishuCardActionBody(request.body);
      if (action.challenge) return { challenge: action.challenge };
      void runFeishuSelectionAction(action).catch((error) => {
        request.log.error({ err: error, action: action.action, platform: action.platform, taskIndex: action.taskIndex }, 'MoboBoost menu event failed');
      });
      return { ok: true };
    } catch (error) {
      request.log.error({ err: error }, 'MoboBoost menu event parse failed');
      return { ok: true };
    }
  });
}

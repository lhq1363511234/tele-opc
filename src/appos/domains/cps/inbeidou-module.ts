import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { DependencyRegistry, type AppDependency } from '../../dependencies/registry.js';
import {
  buildDifyPayload,
  buildFeishuBatchPayloads,
  normalizeInbeidouResults,
  type InbeidouRawTask
} from './inbeidou.js';
import { MoboboostCpsModule } from './moboboost-module.js';
import { ensureCloakBrowserProfileReady } from './cloakbrowser-prerequisites.js';
import { resolveFeishuTableId } from '../../feishu/base-tables.js';
import { enrichTaskWithMedia } from './inbeidou-media.js';
import type { MediaPreprocessOptions, MediaPreprocessReport } from '../../media/preprocess.js';

type RunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandRunner = (input: { command: string; args: string[]; env: NodeJS.ProcessEnv }) => Promise<RunnerResult>;
type TextFileReader = (filePath: string) => Promise<string>;
type FeishuWriter = (input: { tableName: string; payload: { fields: string[]; rows: unknown[][] } }) => Promise<void>;
type DifyTrigger = (input: { payload: ReturnType<typeof buildDifyPayload> }) => Promise<void>;
type MediaPreprocessRunner = (options: MediaPreprocessOptions) => MediaPreprocessReport;
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

type InbeidouTaskCandidate = {
  index: number;
  displayIndex?: number;
  enName?: string;
  chName?: string;
  platform?: string;
  commissionRate?: string;
  infoDesc?: string;
  coverImg?: string;
  sortTag?: string;
};

type InbeidouPlatformTab = {
  index?: number;
  name: string;
};

export type InbeidouCpsIngestInput = {
  all?: boolean;
  tasks?: number[];
  outputDir?: string;
  platform?: string;
  noDownload?: boolean;
  noLinks?: boolean;
  writeFeishu?: boolean;
  triggerDify?: boolean;
  editBriefPath?: string;
  preprocessMedia?: boolean;
};

export type InbeidouFeishuDiscoverInput = {
  outputDir?: string;
  actionBaseUrl?: string;
  requiredDependencies?: string[];
  sendFeishu?: boolean;
  chatId?: string;
};

export type InbeidouFeishuTaskSelectionInput = {
  outputDir?: string;
  platform: string;
  actionBaseUrl?: string;
  sendFeishu?: boolean;
  chatId?: string;
};

export type InbeidouScrapeCommand = {
  command: 'python';
  args: string[];
  env: NodeJS.ProcessEnv;
  outputDir: string;
  resultPath: string;
};

export type InbeidouCpsModuleOptions = {
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
    noLinks: z.boolean().optional(),
    no_links: z.boolean().optional(),
    writeFeishu: z.boolean().optional(),
    write_feishu: z.boolean().optional(),
    triggerDify: z.boolean().optional(),
    trigger_dify: z.boolean().optional(),
    editBriefPath: z.string().min(1).optional(),
    edit_brief_path: z.string().min(1).optional(),
    preprocessMedia: z.boolean().optional(),
    preprocess_media: z.boolean().optional()
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
    writeFeishu: z.boolean().optional(),
    write_feishu: z.boolean().optional(),
    triggerDify: z.boolean().optional(),
    trigger_dify: z.boolean().optional(),
    preprocessMedia: z.boolean().optional(),
    preprocess_media: z.boolean().optional()
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

const DEFAULT_CPS_WORKFLOW_DEPENDENCIES = ['n8n', 'dify', 'cloakbrowser', 'inbeidou_profile', 'capcut_mate', 'feishu_im'];

const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');

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
    '+messages-send',
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
  const raw = result.stdout ? JSON.parse(result.stdout) as unknown : {};
  const messageId =
    raw && typeof raw === 'object' && 'data' in raw
      ? ((raw as { data?: { message_id?: string } }).data?.message_id)
      : undefined;
  return { messageId, raw };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureCpsWorkflowServicesReady(
  input: { requiredDependencies: string[]; dependencyProvider?: DependencyProvider }
): Promise<PrerequisiteResult> {
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
      services.push(await testFeishuImDependency(registry));
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

async function testFeishuImDependency(registry: DependencyProvider) {
  const dependency = await registry.get('feishu_im');
  const chatId = dependency?.env?.chatId ?? process.env.APPOS_FEISHU_CPS_CHAT_ID;
  const identity = dependency?.env?.sendIdentity === 'user' ? 'user' : 'bot';
  if (!chatId) {
    return {
      id: 'feishu_im',
      ok: false,
      message: 'missing feishu_im.env.chatId',
      checkedAt: new Date().toISOString()
    };
  }

  const cliPath = process.platform === 'win32' ? `${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js` : '';
  const command = process.platform === 'win32' ? 'node' : 'lark-cli';
  const args = [
    ...(process.platform === 'win32' ? [cliPath] : []),
    'im',
    'chats',
    'get',
    '--as',
    identity,
    '--chat-id',
    chatId,
    '--format',
    'json'
  ];
  const result = await defaultRunner({ command, args, env: process.env });
  if (result.exitCode !== 0) {
    return {
      id: 'feishu_im',
      ok: false,
      message: result.stderr || result.stdout || 'lark-cli chat check failed'
    };
  }
  return {
    id: 'feishu_im',
    ok: true,
    message: `chat=${chatId}; identity=${identity}`
  };
}

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

function parseCandidateList(raw: string): InbeidouTaskCandidate[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Inbeidou task candidate file must be a JSON array');
  }
  return parsed.map((item) => item as InbeidouTaskCandidate);
}

function parsePlatformTabs(raw: string): InbeidouPlatformTab[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Inbeidou platform tab file must be a JSON array');
  }
  const tabs: InbeidouPlatformTab[] = [];
  parsed.forEach((item, index) => {
      if (typeof item === 'string') {
        tabs.push({ index, name: item });
        return;
      }
      if (item && typeof item === 'object' && 'name' in item) {
        const tab = item as InbeidouPlatformTab;
        if (tab.name?.trim()) tabs.push({ ...tab, index: tab.index ?? index });
      }
    });
  return tabs;
}

function groupCandidatesByPlatform(candidates: InbeidouTaskCandidate[]) {
  const groups = new Map<string, InbeidouTaskCandidate[]>();
  for (const candidate of candidates) {
    const platform = String(candidate.platform || '未知平台').trim() || '未知平台';
    groups.set(platform, [...(groups.get(platform) ?? []), candidate]);
  }
  return [...groups.entries()].map(([name, tasks]) => ({ name, count: tasks.length, tasks }));
}

function isAllPlatform(platform: string) {
  const normalized = platform.trim().toLowerCase();
  return normalized === 'all' || normalized === '全部';
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

function localActionBaseUrl(pathname: string) {
  const baseUrl = (process.env.APPOS_PUBLIC_BASE_URL ?? process.env.APPOS_LOCAL_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
  return `${baseUrl}${pathname}`;
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
            '**选择北斗智影平台**',
            `已完成依赖检查：${input.prerequisites.services.map((service) => `${service.id}:${service.ok ? 'ok' : 'fail'}`).join(' / ')}`,
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
              action: 'inbeidou_select_platform',
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
  tasks: InbeidouTaskCandidate[];
  actionBaseUrl?: string;
}) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**选择短剧**\n平台：${input.platform}\n候选短剧：${input.tasks.length} 部`
        }
      },
      ...input.tasks.map((task) => ({
        tag: 'action',
        actions: [
          feishuButton({
            text: `#${task.displayIndex ?? task.index + 1} ${task.enName || task.chName || '未命名短剧'} ${task.commissionRate ? `/${task.commissionRate}` : ''}`,
            actionBaseUrl: input.actionBaseUrl,
            value: {
              action: 'inbeidou_select_task',
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

export class InbeidouCpsModule {
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

  constructor(options: InbeidouCpsModuleOptions) {
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
    return new InbeidouCpsModule({
      scraperScript:
        process.env.INBEIDOU_CPS_SCRAPER_SCRIPT ??
        path.join('runtime', 'inbeidou-cps-skill', 'inbeidou-cps', 'scripts', 'cps_scrape.py'),
      defaultOutputDir: process.env.CPS_OUTPUT_DIR ?? path.join('runtime', 'inbeidou-cps-output'),
      editBriefPath: process.env.CPS_EDIT_BRIEF_PATH,
      dependencyProvider,
      ensurePrerequisites: ({ requiredDependencies }) =>
        ensureCpsWorkflowServicesReady({ requiredDependencies, dependencyProvider })
    });
  }

  buildScrapeCommand(input: InbeidouCpsIngestInput = {}): InbeidouScrapeCommand {
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
    if (input.noLinks) args.push('--no-links');

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

  async ingest(input: InbeidouCpsIngestInput = {}) {
    const prerequisites = await this.ensurePrerequisites({
      stage: 'ingest',
      requiredDependencies: DEFAULT_CPS_WORKFLOW_DEPENDENCIES
    });
    if (!prerequisites.ok) {
      throw new Error(`CPS workflow dependencies are not ready: ${prerequisites.services.map((s) => `${s.id}=${s.message}`).join('; ')}`);
    }
    const command = this.buildScrapeCommand(input);
    command.env = await this.withRuntimeScraperEnv(command.env, command.outputDir);
    const scrape = await this.runner(command);
    if (scrape.exitCode !== 0) {
      throw new Error(`Inbeidou scraper failed with exit code ${scrape.exitCode}: ${scrape.stderr || scrape.stdout}`);
    }

    const rawResults = JSON.parse(await this.readTextFile(command.resultPath)) as unknown;
    if (!Array.isArray(rawResults)) {
      throw new Error(`Inbeidou scraper result must be a JSON array: ${command.resultPath}`);
    }

    const normalizedTasks = normalizeInbeidouResults(rawResults as InbeidouRawTask[]);
    const shouldPreprocessMedia = input.preprocessMedia === true || Boolean(this.mediaPreprocess);
    const tasks = shouldPreprocessMedia
      ? normalizedTasks.map((task) =>
          enrichTaskWithMedia(task, {
            outputDir: path.join(command.outputDir, 'media-analysis'),
            language: process.env.CPS_MEDIA_LANGUAGE ?? task.language ?? 'en',
            whisperModelPath: process.env.APPOS_WHISPER_MODEL_PATH || undefined,
            whisperCliPath: process.env.APPOS_WHISPER_CLI_PATH || undefined,
            whisperCliModel: process.env.APPOS_WHISPER_CLI_MODEL || undefined,
            whisperCliTimeoutMs: Number(process.env.APPOS_WHISPER_CLI_TIMEOUT_MS || 900000),
            preprocess: this.mediaPreprocess
          })
        )
      : normalizedTasks;
    const feishuPayloads = buildFeishuBatchPayloads(tasks);
    const difyPayload = buildDifyPayload(tasks, {
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

  buildDiscoverCommand(input: InbeidouFeishuDiscoverInput & { platform?: string } = {}): InbeidouScrapeCommand {
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

  async discoverForFeishu(input: InbeidouFeishuDiscoverInput = {}) {
    const requiredDependencies = input.requiredDependencies ?? DEFAULT_CPS_WORKFLOW_DEPENDENCIES;
    const prerequisites = await this.ensurePrerequisites({ stage: 'discover', requiredDependencies });
    if (!prerequisites.ok) {
      throw new Error(`CPS workflow dependencies are not ready: ${prerequisites.services.map((s) => `${s.id}=${s.message}`).join('; ')}`);
    }

    const command = this.buildDiscoverCommand(input);
    command.env = await this.withRuntimeScraperEnv(command.env, command.outputDir);
    const scrape = await this.runner(command);
    if (scrape.exitCode !== 0) {
      throw new Error(`Inbeidou discover failed with exit code ${scrape.exitCode}: ${scrape.stderr || scrape.stdout}`);
    }

    const candidates = parseCandidateList(await this.readTextFile(command.resultPath));
    let platforms: Array<{ name: string; count: number }>;
    try {
      platforms = parsePlatformTabs(await this.readTextFile(path.join(command.outputDir, 'platform_tabs.json')))
        .map((platform) => ({ name: platform.name, count: 0 }));
    } catch {
      platforms = groupCandidatesByPlatform(candidates).map((platform) => ({ name: platform.name, count: platform.count }));
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
      platforms: platforms.map((platform) => ({ name: platform.name, count: platform.count })),
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

  async buildFeishuTaskSelection(input: InbeidouFeishuTaskSelectionInput) {
    const outputDir = input.outputDir ?? this.defaultOutputDir;
    const prerequisites = await this.ensurePrerequisites({
      stage: 'discover',
      requiredDependencies: DEFAULT_CPS_WORKFLOW_DEPENDENCIES
    });
    if (!prerequisites.ok) {
      throw new Error(`CPS workflow dependencies are not ready: ${prerequisites.services.map((s) => `${s.id}=${s.message}`).join('; ')}`);
    }
    const command = this.buildDiscoverCommand({ outputDir, platform: input.platform });
    command.env = await this.withRuntimeScraperEnv(command.env, command.outputDir);
    const scrape = await this.runner(command);
    if (scrape.exitCode !== 0) {
      throw new Error(`Inbeidou platform discover failed with exit code ${scrape.exitCode}: ${scrape.stderr || scrape.stdout}`);
    }
    const candidates = parseCandidateList(await this.readTextFile(path.join(outputDir, 'task_candidates.json')));
    const tasks = candidates;
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

  private async withRuntimeScraperEnv(env: NodeJS.ProcessEnv, outputDir: string) {
    const [manager, profile] = await Promise.all([
      this.dependencyProvider?.get('cloakbrowser'),
      this.dependencyProvider?.get('inbeidou_profile')
    ]);
    return {
      ...env,
      PYTHONIOENCODING: env.PYTHONIOENCODING || 'utf-8',
      CPS_OUTPUT_DIR: outputDir,
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
    const command =
      process.platform === 'win32' ? 'node' : 'lark-cli';
    const prefixArgs =
      process.platform === 'win32'
        ? [`${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js`]
        : [];
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

  private async triggerDifyWorkflow(payload: ReturnType<typeof buildDifyPayload>) {
    if (this.difyTrigger) {
      await this.difyTrigger({ payload });
      return;
    }
    const webhookUrl = process.env.APPOS_DIFY_INBEIDOU_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('APPOS_DIFY_INBEIDOU_WEBHOOK_URL is required to trigger Dify');
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

function normalizeRouteBody(payload: unknown): InbeidouCpsIngestInput {
  const body = routeBodySchema.parse(payload);
  return {
    all: body.all,
    tasks: body.tasks,
    outputDir: body.outputDir ?? body.output_dir,
    platform: body.platform,
    noDownload: body.noDownload ?? body.no_download,
    noLinks: body.noLinks ?? body.no_links,
    writeFeishu: body.writeFeishu ?? body.write_feishu,
    triggerDify: body.triggerDify ?? body.trigger_dify,
    editBriefPath: body.editBriefPath ?? body.edit_brief_path,
    preprocessMedia: body.preprocessMedia ?? body.preprocess_media
  };
}

function normalizeFeishuDiscoverBody(payload: unknown): InbeidouFeishuDiscoverInput {
  const body = feishuDiscoverBodySchema.parse(payload ?? {});
  return {
    outputDir: body.outputDir ?? body.output_dir,
    actionBaseUrl: body.actionBaseUrl ?? body.action_base_url,
    requiredDependencies: body.requiredDependencies ?? body.required_dependencies,
    sendFeishu: body.sendFeishu ?? body.send_feishu,
    chatId: body.chatId ?? body.chat_id
  };
}

function normalizeFeishuTaskSelectionBody(payload: unknown): InbeidouFeishuTaskSelectionInput {
  const body = feishuTaskSelectionBodySchema.parse(payload ?? {});
  return {
    outputDir: body.outputDir ?? body.output_dir,
    platform: body.platform,
    actionBaseUrl: body.actionBaseUrl ?? body.action_base_url,
    sendFeishu: body.sendFeishu ?? body.send_feishu,
    chatId: body.chatId ?? body.chat_id
  };
}

function normalizeFeishuTaskRunBody(payload: unknown): InbeidouCpsIngestInput {
  const body = feishuTaskRunBodySchema.parse(payload ?? {});
  const taskIndex = body.taskIndex ?? body.task_index;
  if (taskIndex === undefined) {
    throw new Error('taskIndex is required');
  }
  return {
    outputDir: body.outputDir ?? body.output_dir,
    platform: body.platform,
    tasks: [taskIndex],
    writeFeishu: body.writeFeishu ?? body.write_feishu ?? true,
    triggerDify: body.triggerDify ?? body.trigger_dify ?? false,
    preprocessMedia: body.preprocessMedia ?? body.preprocess_media
  };
}

function readQueryStringValue(value: unknown) {
  if (Array.isArray(value)) return readQueryStringValue(value[0]);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeFeishuTaskSelectionQuery(query: unknown): InbeidouFeishuTaskSelectionInput {
  const record = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const platform = readQueryStringValue(record.platform);
  if (!platform) throw new Error('platform is required');
  return {
    outputDir: readQueryStringValue(record.outputDir) ?? readQueryStringValue(record.output_dir),
    platform,
    actionBaseUrl: readQueryStringValue(record.actionBaseUrl) ?? readQueryStringValue(record.action_base_url),
    sendFeishu: true,
    chatId: readQueryStringValue(record.chatId) ?? readQueryStringValue(record.chat_id)
  };
}

function normalizeFeishuTaskRunQuery(query: unknown): InbeidouCpsIngestInput {
  const record = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const rawTaskIndex = readQueryStringValue(record.taskIndex) ?? readQueryStringValue(record.task_index);
  const parsedTaskIndex = rawTaskIndex === undefined ? Number.NaN : Number(rawTaskIndex);
  if (!Number.isInteger(parsedTaskIndex) || parsedTaskIndex < 0) {
    throw new Error('taskIndex is required');
  }
  return {
    outputDir: readQueryStringValue(record.outputDir) ?? readQueryStringValue(record.output_dir),
    platform: readQueryStringValue(record.platform),
    tasks: [parsedTaskIndex],
    writeFeishu: true,
    triggerDify: false
  };
}

function normalizeFeishuCardActionBody(payload: unknown) {
  const body = feishuCardActionBodySchema.parse(payload ?? {});
  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const rawEvent = raw.event && typeof raw.event === 'object' ? raw.event as Record<string, unknown> : {};
  const rawEventAction = rawEvent.action && typeof rawEvent.action === 'object' ? rawEvent.action as Record<string, unknown> : {};
  const rawAction = raw.action && typeof raw.action === 'object' ? raw.action as Record<string, unknown> : {};
  const eventValue = rawEventAction.value && typeof rawEventAction.value === 'object' ? rawEventAction.value as Record<string, unknown> : undefined;
  const actionValue = rawAction.value && typeof rawAction.value === 'object' ? rawAction.value as Record<string, unknown> : undefined;
  const value = body.value && typeof body.value === 'object' ? body.value as Record<string, unknown> : eventValue ?? actionValue ?? {};
  const eventKey = typeof rawEvent.event_key === 'string' ? rawEvent.event_key : undefined;
  const action = body.action ?? (typeof value.action === 'string' ? value.action : undefined) ?? eventKey;
  const platform = body.platform ?? (typeof value.platform === 'string' ? value.platform : undefined);
  const outputDir =
    body.outputDir ??
    body.output_dir ??
    (typeof value.outputDir === 'string' ? value.outputDir : undefined) ??
    (typeof value.output_dir === 'string' ? value.output_dir : undefined);
  const rawTaskIndex =
    body.taskIndex ??
    body.task_index ??
    (typeof value.taskIndex === 'number' ? value.taskIndex : undefined) ??
    (typeof value.task_index === 'number' ? value.task_index : undefined) ??
    (typeof value.taskIndex === 'string' ? Number(value.taskIndex) : undefined) ??
    (typeof value.task_index === 'string' ? Number(value.task_index) : undefined);
  return { action, platform, outputDir, taskIndex: rawTaskIndex, challenge: body.challenge };
}

function feishuCardToast(content: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  return {
    toast: {
      type,
      content
    }
  };
}

export function registerInbeidouCpsRoutes(
  app: FastifyInstance<any, any, any, any>,
  module: InbeidouCpsModule = InbeidouCpsModule.fromEnv()
) {
  const runFeishuSelectionAction = async (action: ReturnType<typeof normalizeFeishuCardActionBody>) => {
    if (action.action?.startsWith('moboboost_')) {
      const moboboost = MoboboostCpsModule.fromEnv();
      if (action.action === 'moboboost_start_selection' || action.action === 'moboboost_select_start') {
        await moboboost.discoverForFeishu({
          outputDir: action.outputDir,
          sendFeishu: true
        });
        return;
      }
      if (action.action === 'moboboost_select_platform') {
        if (!action.platform) {
          throw new Error('platform is required');
        }
        await moboboost.buildFeishuTaskSelection({
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
        await moboboost.ingest({
          outputDir: action.outputDir,
          platform: action.platform,
          tasks: [taskIndex],
          writeFeishu: true,
          triggerDify: false
        });
        return;
      }
    }
    if (action.action === 'inbeidou_start_selection' || action.action === 'inbeidou_select_start') {
      await module.discoverForFeishu({
        outputDir: action.outputDir,
        sendFeishu: true
      });
      return;
    }
    if (action.action === 'inbeidou_select_platform') {
      if (!action.platform) {
        throw new Error('platform is required');
      }
      await module.buildFeishuTaskSelection({
        outputDir: action.outputDir,
        platform: action.platform,
        sendFeishu: true
      });
      return;
    }
    if (action.action === 'inbeidou_select_task') {
      const taskIndex = action.taskIndex;
      if (!Number.isInteger(taskIndex) || taskIndex === undefined || taskIndex < 0) {
        throw new Error('taskIndex is required');
      }
      await module.ingest({
        outputDir: action.outputDir,
        platform: action.platform,
        tasks: [taskIndex],
        writeFeishu: true,
        triggerDify: false
      });
      return;
    }
    throw new Error(`unsupported card action: ${action.action ?? '<empty>'}`);
  };

  app.post('/api/appos/cps/inbeidou/ingest', async (request, reply) => {
    try {
      const result = await module.ingest(normalizeRouteBody(request.body));
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('tasks must be non-negative integers')) {
        reply.code(400);
        return { ok: false, error: message };
      }
      reply.code(500);
      return { ok: false, error: message };
    }
  });

  app.post('/api/appos/cps/inbeidou/feishu/select/start', async (request, reply) => {
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

  app.post('/api/appos/cps/inbeidou/feishu/select/platform', async (request, reply) => {
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

  app.get('/api/appos/cps/inbeidou/feishu/select/platform', async (request, reply) => {
    try {
      const result = await module.buildFeishuTaskSelection(normalizeFeishuTaskSelectionQuery(request.query));
      return { ok: true, message: 'Short-drama selection card sent to Feishu.', ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('platform is required')) {
        reply.code(400);
        return { ok: false, error: message };
      }
      reply.code(500);
      return { ok: false, error: message };
    }
  });

  app.post('/api/appos/cps/inbeidou/feishu/select/task', async (request, reply) => {
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

  app.post('/api/appos/cps/inbeidou/feishu/card-action', async (request) => {
    try {
      const action = normalizeFeishuCardActionBody(request.body);
      if (action.challenge) {
        return { challenge: action.challenge };
      }

      void runFeishuSelectionAction(action).catch((error) => {
        request.log.error(
          {
            err: error,
            action: action.action,
            platform: action.platform,
            taskIndex: action.taskIndex
          },
          'Feishu Inbeidou card action failed after ACK'
        );
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
      if (action.action === 'inbeidou_select_platform') {
        return feishuCardToast('已收到平台选择，正在拉取短剧列表');
      }
      if (action.action === 'inbeidou_select_task') {
        return feishuCardToast('已收到选剧请求，正在采集素材并写入流程');
      }
      if (action.action === 'inbeidou_start_selection' || action.action === 'inbeidou_select_start') {
        return feishuCardToast('已收到，正在检查服务并拉取平台');
      }

      return feishuCardToast('未识别的操作，已记录日志', 'warning');
    } catch (error) {
      if (error instanceof ZodError) {
        return feishuCardToast(`卡片参数错误：${formatZodError(error)}`, 'warning');
      }
      request.log.error({ err: error }, 'Feishu Inbeidou card action parse failed');
      return feishuCardToast('卡片回调处理失败，已记录日志', 'error');
    }
  });

  app.post('/api/appos/cps/inbeidou/feishu/menu-event', async (request) => {
    try {
      const action = normalizeFeishuCardActionBody(request.body);
      if (action.challenge) {
        return { challenge: action.challenge };
      }
      void runFeishuSelectionAction(action).catch((error) => {
        request.log.error(
          {
            err: error,
            action: action.action,
            platform: action.platform,
            taskIndex: action.taskIndex
          },
          'Feishu Inbeidou menu event failed after ACK'
        );
      });
      return { ok: true };
    } catch (error) {
      request.log.error({ err: error }, 'Feishu Inbeidou menu event parse failed');
      return { ok: true };
    }
  });

  app.get('/api/appos/cps/inbeidou/feishu/select/task', async (request, reply) => {
    try {
      const result = await module.ingest(normalizeFeishuTaskRunQuery(request.query));
      return { ok: true, message: 'Inbeidou task ingest started from Feishu selection.', ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('taskIndex is required') || message.includes('tasks must be non-negative integers')) {
        reply.code(400);
        return { ok: false, error: message };
      }
      reply.code(500);
      return { ok: false, error: message };
    }
  });
}

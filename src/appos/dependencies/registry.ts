import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';

export type DependencyMode = 'external' | 'managed' | 'disabled';

export type AppDependency = {
  id: string;
  name: string;
  category: string;
  mode: DependencyMode;
  baseUrl?: string;
  healthCheckUrl?: string;
  apiKey?: string;
  startCommand?: string;
  stopCommand?: string;
  restartCommand?: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  notes?: string;
};

export type DependencyStatus = {
  id: string;
  ok: boolean;
  status?: number;
  message: string;
  checkedAt: string;
};

type StoredConfig = {
  dependencies?: AppDependency[];
};

type RegistryOptions = {
  configPath?: string;
  fetch?: typeof fetch;
  spawnDetached?: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => void;
};

const dependencySchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  mode: z.enum(['external', 'managed', 'disabled']),
  baseUrl: z.string().trim().optional().default(''),
  healthCheckUrl: z.string().trim().optional().default(''),
  apiKey: z.string().trim().optional().default(''),
  startCommand: z.string().trim().optional().default(''),
  stopCommand: z.string().trim().optional().default(''),
  restartCommand: z.string().trim().optional().default(''),
  workingDirectory: z.string().trim().optional().default(''),
  env: z.record(z.string()).optional().default({}),
  notes: z.string().trim().optional().default('')
});

const routeDependencySchema = dependencySchema.omit({ id: true }).partial().extend({
  id: z.string().trim().min(1).max(80).optional()
});

export const defaultDependencies: AppDependency[] = [
  {
    id: 'dify',
    name: 'Dify',
    category: 'ai_workflow',
    mode: 'external',
    baseUrl: 'http://127.0.0.1:5001',
    healthCheckUrl: 'http://127.0.0.1:5001/console/api/setup',
    notes: '顶层 AI 工作流和剪辑策划入口。'
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'workflow',
    mode: 'external',
    baseUrl: 'http://127.0.0.1:5678',
    healthCheckUrl: 'http://127.0.0.1:5678/healthz',
    notes: '流程编排、飞书/Telegram 回调、状态写入。'
  },
  {
    id: 'cloakbrowser',
    name: 'CloakBrowser Manager',
    category: 'browser',
    mode: 'managed',
    baseUrl: 'http://127.0.0.1:8080',
    healthCheckUrl: 'http://127.0.0.1:8080/api/profiles',
    notes: '多账号浏览器 Profile 管理和北斗智影采集。'
  },
  {
    id: 'inbeidou_profile',
    name: '北斗智影 Profile',
    category: 'browser_profile',
    mode: 'managed',
    notes: '填写 CloakBrowser 中已登录北斗智影的 Profile ID。'
  },
  {
    id: 'capcut_mate',
    name: 'capcut-mate',
    category: 'editing',
    mode: 'external',
    baseUrl: 'http://127.0.0.1:30000',
    healthCheckUrl: 'http://127.0.0.1:30000/health',
    notes: '剪映草稿创建、素材/字幕/特效添加和导出。'
  },
  {
    id: 'ffmpeg',
    name: 'ffmpeg / ffprobe',
    category: 'media',
    mode: 'external',
    notes: '媒体信息检查、抽帧、黑屏检测、格式转换。'
  },
  {
    id: 'asr',
    name: 'ASR',
    category: 'media_ai',
    mode: 'external',
    notes: '英文字幕/转写服务或本地模型。'
  },
  {
    id: 'feishu_base',
    name: '飞书 Base',
    category: 'storage',
    mode: 'external',
    notes: '沉淀 CPS 任务、素材、分析结果、剪辑计划、发布数据。'
  },
  {
    id: 'feishu_im',
    name: '飞书消息',
    category: 'command_channel',
    mode: 'external',
    notes: '飞书选剧卡片、审批卡和结果通知发送目标。env.chatId 保存默认群聊 ID。'
  },
  {
    id: 'telegram_bot',
    name: 'Telegram Bot',
    category: 'command_channel',
    mode: 'external',
    notes: '老板指令入口、审批入口和结果通知入口。'
  }
];

function defaultConfigPath() {
  return path.resolve(process.cwd(), 'runtime', 'appos-local-config.json');
}

function mergeDefaults(stored: AppDependency[]) {
  const byId = new Map(defaultDependencies.map((item) => [item.id, item]));
  for (const item of stored) {
    byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item });
  }
  return [...byId.values()];
}

function parseCommand(commandLine: string) {
  return commandLine.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

function redactDependency(dependency: AppDependency) {
  return {
    ...dependency,
    apiKey: dependency.apiKey ? '********' : ''
  };
}

const defaultSpawnDetached = (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: true
  });
  child.unref();
};

export class DependencyRegistry {
  readonly configPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnDetached: NonNullable<RegistryOptions['spawnDetached']>;

  constructor(options: RegistryOptions = {}) {
    this.configPath = path.resolve(options.configPath ?? process.env.APPOS_LOCAL_CONFIG_PATH ?? defaultConfigPath());
    this.fetchImpl = options.fetch ?? fetch;
    this.spawnDetached = options.spawnDetached ?? defaultSpawnDetached;
  }

  async list() {
    return mergeDefaults((await this.readConfig()).dependencies ?? []);
  }

  async get(id: string) {
    return (await this.list()).find((item) => item.id === id);
  }

  async upsert(input: AppDependency) {
    const parsed = dependencySchema.parse(input);
    const config = await this.readConfig();
    const current = mergeDefaults(config.dependencies ?? []);
    const next = current.map((item) => (item.id === parsed.id ? { ...item, ...parsed } : item));
    if (!next.some((item) => item.id === parsed.id)) next.push(parsed);
    await this.writeConfig({ ...config, dependencies: next });
    return parsed;
  }

  async test(id: string): Promise<DependencyStatus> {
    const dependency = await this.get(id);
    if (!dependency) throw new Error(`dependency not found: ${id}`);
    const url = dependency.healthCheckUrl || dependency.baseUrl;
    if (!url) {
      return {
        id,
        ok: false,
        message: 'missing healthCheckUrl/baseUrl',
        checkedAt: new Date().toISOString()
      };
    }
    try {
      const response = await this.fetchImpl(url, { method: 'GET' });
      return {
        id,
        ok: response.ok,
        status: response.status,
        message: response.ok ? 'ok' : `HTTP ${response.status}`,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString()
      };
    }
  }

  async start(id: string) {
    return this.runManagedCommand(id, 'startCommand', 'started');
  }

  async stop(id: string) {
    return this.runManagedCommand(id, 'stopCommand', 'stopped');
  }

  async restart(id: string) {
    return this.runManagedCommand(id, 'restartCommand', 'restarted');
  }

  private async runManagedCommand(id: string, commandField: 'startCommand' | 'stopCommand' | 'restartCommand', resultKey: string) {
    const dependency = await this.get(id);
    if (!dependency) throw new Error(`dependency not found: ${id}`);
    if (dependency.mode !== 'managed') throw new Error(`${id} is not configured as managed`);
    const commandLine = dependency[commandField];
    if (!commandLine) throw new Error(`${id} missing ${commandField}`);
    const [command, ...args] = parseCommand(commandLine);
    if (!command) throw new Error(`${id} missing ${commandField}`);
    this.spawnDetached(command, args, {
      cwd: dependency.workingDirectory || undefined,
      env: { ...process.env, ...(dependency.env ?? {}) }
    });
    return { id, [resultKey]: true };
  }

  private async readConfig(): Promise<StoredConfig> {
    try {
      return JSON.parse(await readFile(this.configPath, 'utf8')) as StoredConfig;
    } catch {
      return {};
    }
  }

  private async writeConfig(config: StoredConfig) {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}

export function registerDependencyRegistryRoutes(
  app: FastifyInstance<any, any, any, any>,
  registry = new DependencyRegistry()
) {
  app.get('/api/appos/dependencies', async () => ({
    ok: true,
    configPath: registry.configPath,
    dependencies: (await registry.list()).map(redactDependency)
  }));

  app.get<{ Params: { id: string } }>('/api/appos/dependencies/:id', async (request, reply) => {
    const dependency = await registry.get(request.params.id);
    if (!dependency) {
      reply.code(404);
      return { ok: false, error: 'dependency_not_found' };
    }
    return { ok: true, dependency: redactDependency(dependency) };
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/appos/dependencies/:id', async (request, reply) => {
    try {
      const body = routeDependencySchema.parse(request.body ?? {});
      const existing = await registry.get(request.params.id);
      const dependency = await registry.upsert({
        id: request.params.id,
        name: body.name ?? existing?.name ?? request.params.id,
        category: body.category ?? existing?.category ?? 'custom',
        mode: body.mode ?? existing?.mode ?? 'external',
        baseUrl: body.baseUrl ?? existing?.baseUrl ?? '',
        healthCheckUrl: body.healthCheckUrl ?? existing?.healthCheckUrl ?? '',
        apiKey: body.apiKey && body.apiKey !== '********' ? body.apiKey : existing?.apiKey ?? '',
        startCommand: body.startCommand ?? existing?.startCommand ?? '',
        stopCommand: body.stopCommand ?? existing?.stopCommand ?? '',
        restartCommand: body.restartCommand ?? existing?.restartCommand ?? '',
        workingDirectory: body.workingDirectory ?? existing?.workingDirectory ?? '',
        env: body.env ?? existing?.env ?? {},
        notes: body.notes ?? existing?.notes ?? ''
      });
      return { ok: true, dependency: redactDependency(dependency) };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post<{ Params: { id: string } }>('/api/appos/dependencies/:id/test', async (request, reply) => {
    try {
      return { ok: true, status: await registry.test(request.params.id) };
    } catch (error) {
      reply.code(404);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post<{ Params: { id: string } }>('/api/appos/dependencies/:id/start', async (request, reply) => {
    try {
      return { ok: true, result: await registry.start(request.params.id) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post<{ Params: { id: string } }>('/api/appos/dependencies/:id/stop', async (request, reply) => {
    try {
      return { ok: true, result: await registry.stop(request.params.id) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post<{ Params: { id: string } }>('/api/appos/dependencies/:id/restart', async (request, reply) => {
    try {
      return { ok: true, result: await registry.restart(request.params.id) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

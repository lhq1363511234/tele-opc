import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentTool } from './agentRunner.js';

export interface WorkspaceToolRepositories {
  createArtifact(params: {
    taskId?: string;
    type: string;
    title: string;
    uri?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

export interface WorkspaceToolOptions {
  /** Task the published artifacts belong to. */
  taskId?: string;
  /**
   * Shared workspace key. Sibling steps of one workflow must pass the parent
   * task id here, otherwise each step builds its own copy of the deliverable
   * from scratch and later steps cannot see or refine earlier work.
   */
  workspaceId?: string;
  rootDir?: string;
}

/**
 * Executables an agent may run inside its own workspace. Anything that reaches
 * outside the workspace, changes the host, or needs credentials is deliberately
 * absent — outward actions go through the approval-gated tools instead.
 */
const ALLOWED_COMMANDS = new Set([
  'node', 'npm', 'npx', 'python3', 'pip3', 'tsc',
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'sed', 'awk', 'sort', 'uniq', 'diff',
  'mkdir', 'cp', 'mv', 'rm', 'touch', 'zip', 'unzip', 'tar', 'curl', 'git'
]);

const MAX_FILE_CHARS = 400_000;
const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function workspaceRoot(options: WorkspaceToolOptions) {
  const base = options.rootDir ?? path.resolve(process.cwd(), 'runtime', 'workspaces');
  return path.join(base, options.workspaceId ?? options.taskId ?? 'scratch');
}

/** Keeps every path the agent supplies inside its own workspace. */
function resolveInside(root: string, relative: string) {
  const cleaned = String(relative ?? '').trim().replace(/^\/+/, '');
  if (!cleaned) return null;
  const resolved = path.resolve(root, cleaned);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

async function listWorkspaceFiles(root: string, limit = 300) {
  const results: Array<{ path: string; bytes: number }> = [];
  async function walk(dir: string) {
    if (results.length >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const stat = await fs.stat(full).catch(() => null);
        results.push({ path: path.relative(root, full), bytes: stat?.size ?? 0 });
      }
    }
  }
  await walk(root);
  return results;
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, HOME: cwd, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout: stdout.slice(0, MAX_OUTPUT_CHARS), stderr: stderr.slice(0, MAX_OUTPUT_CHARS), timedOut });
    });
  });
}

/**
 * A general build surface. An agent that can write files, run them, and publish
 * the result can deliver a website, a script, a dataset or a document without
 * the platform shipping a bespoke engine for each of those shapes.
 */
export function buildWorkspaceTools(
  repos: WorkspaceToolRepositories,
  options: WorkspaceToolOptions = {}
): AgentTool[] {
  const root = workspaceRoot(options);
  const ensureRoot = async () => {
    await fs.mkdir(root, { recursive: true });
    return root;
  };

  return [
    {
      name: 'write_file',
      description:
        'Create or overwrite a file in your private task workspace. Use this to actually produce code, HTML, config, data or documents instead of only describing them.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path inside the workspace, e.g. site/index.html or scripts/scrape.py.' },
          content: { type: 'string', description: 'Full file content.' },
          append: { type: 'boolean', description: 'Append instead of overwrite. Defaults to false.' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      },
      async execute(input) {
        await ensureRoot();
        const target = resolveInside(root, String(input.path ?? ''));
        if (!target) return { ok: false, error: 'invalid_path' };
        const content = String(input.content ?? '');
        if (content.length > MAX_FILE_CHARS) return { ok: false, error: 'content_too_large', maxChars: MAX_FILE_CHARS };
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (input.append === true) {
          await fs.appendFile(target, content, 'utf8');
        } else {
          await fs.writeFile(target, content, 'utf8');
        }
        const stat = await fs.stat(target);
        return { ok: true, path: path.relative(root, target), bytes: stat.size };
      }
    },
    {
      name: 'read_file',
      description: 'Read a file back from your task workspace, so you can verify or revise what you produced.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxChars: { type: 'number', description: 'Defaults to 20000.' }
        },
        required: ['path'],
        additionalProperties: false
      },
      async execute(input) {
        const target = resolveInside(root, String(input.path ?? ''));
        if (!target) return { ok: false, error: 'invalid_path' };
        const maxChars = Math.max(500, Math.min(MAX_FILE_CHARS, Number(input.maxChars) || 20_000));
        const content = await fs.readFile(target, 'utf8').catch(() => null);
        if (content === null) return { ok: false, error: 'not_found', path: String(input.path) };
        return { ok: true, path: path.relative(root, target), truncated: content.length > maxChars, content: content.slice(0, maxChars) };
      }
    },
    {
      name: 'list_workspace',
      description: 'List every file you have produced in this task workspace.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        await ensureRoot();
        const files = await listWorkspaceFiles(root);
        return { ok: true, root: path.relative(process.cwd(), root), fileCount: files.length, files };
      }
    },
    {
      name: 'run_command',
      description:
        'Run a command inside your task workspace to build, test or verify what you produced. Only the workspace is writable; there is no shell, so pass the program and its arguments separately.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: `One of: ${[...ALLOWED_COMMANDS].join(', ')}` },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments, one element each.' },
          timeoutMs: { type: 'number', description: 'Up to 300000, defaults to 120000.' }
        },
        required: ['command'],
        additionalProperties: false
      },
      async execute(input) {
        await ensureRoot();
        const command = String(input.command ?? '').trim();
        if (!ALLOWED_COMMANDS.has(command)) {
          return { ok: false, error: 'command_not_allowed', command, allowed: [...ALLOWED_COMMANDS] };
        }
        const args = Array.isArray(input.args)
          ? input.args.filter((arg): arg is string => typeof arg === 'string')
          : [];
        const timeoutMs = Math.max(1000, Math.min(300_000, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS));
        const result = await runCommand(command, args, root, timeoutMs);
        return {
          ok: result.exitCode === 0 && !result.timedOut,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr
        };
      }
    },
    {
      name: 'publish_deliverable',
      description:
        'Turn files from your workspace into deliverables the owner can open in the console. HTML files become live previews; anything else is stored as readable content. Call this once the work is genuinely finished.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Deliverable title, e.g. 恒达精密官网.' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Workspace paths to publish. Publish the entry page or main file first.'
          },
          summary: { type: 'string', description: 'What was delivered, how to use it, what remains.' }
        },
        required: ['title', 'paths'],
        additionalProperties: false
      },
      async execute(input) {
        const title = String(input.title ?? '').trim();
        const rawPaths = Array.isArray(input.paths)
          ? input.paths.filter((value): value is string => typeof value === 'string').slice(0, 25)
          : [];
        if (!title) return { ok: false, error: 'title_required' };
        if (!rawPaths.length) return { ok: false, error: 'paths_required' };

        const published: Array<{ artifactId: string; path: string; type: string; previewPath: string }> = [];
        const missing: string[] = [];
        for (const relative of rawPaths) {
          const target = resolveInside(root, relative);
          if (!target) {
            missing.push(relative);
            continue;
          }
          const content = await fs.readFile(target, 'utf8').catch(() => null);
          if (content === null) {
            missing.push(relative);
            continue;
          }
          const normalized = path.relative(root, target);
          const isHtml = /\.html?$/i.test(normalized) || /^\s*<!doctype html|<html[\s>]/i.test(content);
          const type = isHtml ? 'html_page' : 'file';
          const artifact = await repos.createArtifact({
            taskId: options.taskId,
            type,
            title: rawPaths.length > 1 ? `${title} · ${normalized}` : title,
            uri: options.taskId ? `tele-opc://workspace/${options.taskId}/${normalized}` : undefined,
            content: content.slice(0, MAX_FILE_CHARS),
            metadata: { source: 'workspace', workspacePath: normalized }
          });
          published.push({ artifactId: artifact.id, path: normalized, type, previewPath: `/deliverables/${artifact.id}` });
        }

        if (!published.length) return { ok: false, error: 'nothing_published', missing };

        if (published.length > 1 || input.summary) {
          await repos.createArtifact({
            taskId: options.taskId,
            type: 'report',
            title: `${title} · 交付说明`,
            content: [
              `# ${title}`,
              '',
              '## 交付内容',
              ...published.map((item, index) => `${index + 1}. ${item.path} — 预览 ${item.previewPath}`),
              input.summary ? `\n## 说明\n\n${String(input.summary)}` : ''
            ].filter(Boolean).join('\n'),
            metadata: { source: 'workspace', artifactIds: published.map((item) => item.artifactId) }
          });
        }

        return { ok: true, publishedCount: published.length, published, missing };
      }
    }
  ];
}

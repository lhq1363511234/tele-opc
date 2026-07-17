import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

export interface CodexBridgeConfig {
  enabled: boolean;
  mode: 'inbox' | 'exec';
  cliPath: string;
  session: string;
  timeoutMs: number;
  dangerousBypass: boolean;
  inboxPath: string;
  maxPromptChars: number;
}

export interface CodexBridgeCommand {
  mode: 'default' | 'inbox' | 'exec' | 'status' | 'help';
  prompt?: string;
}

export interface CodexBridgeContext {
  telegramUserId: number;
  chatId: string;
  messageId?: string;
}

export function parseCodexBridgeCommand(text: string | undefined): CodexBridgeCommand | null {
  const normalized = (text ?? '').trim();
  if (!normalized.startsWith('/codex')) return null;

  const rest = normalized.replace(/^\/codex(?:@\w+)?\b/i, '').trim();
  if (!rest) return { mode: 'help' };
  const [first, ...remaining] = rest.split(/\s+/);
  if (first === 'status') return { mode: 'status' };
  if (first === 'inbox') return { mode: 'inbox', prompt: remaining.join(' ').trim() };
  if (first === 'exec') return { mode: 'exec', prompt: remaining.join(' ').trim() };
  return { mode: 'default', prompt: rest };
}

export class CodexBridge {
  private chain = Promise.resolve();

  constructor(private readonly config: CodexBridgeConfig) {}

  async handle(command: CodexBridgeCommand, context: CodexBridgeContext) {
    if (command.mode === 'help') return this.helpText();
    if (command.mode === 'status') return this.statusText();
    if (!this.config.enabled) {
      return [
        'Codex Bridge 还没启用。',
        '',
        '在 `.env` 设置 `CODEX_BRIDGE_ENABLED=true` 后重启 API/worker。'
      ].join('\n');
    }

    const prompt = (command.prompt ?? '').trim();
    if (!prompt) return '请在 `/codex` 后面写要转发给 Codex 的消息。';

    await this.writeInbox(command, context);
    const effectiveMode = command.mode === 'default' ? this.config.mode : command.mode;
    if (effectiveMode === 'inbox') {
      return [
        '已投递到 Codex Inbox。',
        '',
        `Inbox：${path.resolve(this.config.inboxPath)}`,
        '',
        '当前 Windows Codex 桌面端没有公开的“注入当前窗口”HTTP 接口；这条消息已安全落地，当前窗口可以读取处理。'
      ].join('\n');
    }

    return this.enqueueExec(prompt, context);
  }

  private async enqueueExec(prompt: string, context: CodexBridgeContext) {
    const run = this.chain.then(() => this.runCodexExec(prompt, context));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async writeInbox(command: CodexBridgeCommand, context: CodexBridgeContext) {
    const file = path.resolve(this.config.inboxPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const entry = {
      id: `cbin_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      mode: command.mode,
      prompt: command.prompt,
      telegramUserId: context.telegramUserId,
      chatId: context.chatId,
      messageId: context.messageId
    };
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private async runCodexExec(prompt: string, context: CodexBridgeContext) {
    const runId = `cbr_${randomUUID()}`;
    const outputDir = path.resolve('runtime', 'codex-bridge');
    const outputFile = path.join(outputDir, `${runId}.txt`);
    await fs.mkdir(outputDir, { recursive: true });

    const args = this.execArgs(outputFile);
    const wrappedPrompt = buildTelegramCodexPrompt(prompt.slice(0, this.config.maxPromptChars), context);
    const result = await spawnWithInput(this.config.cliPath, args, wrappedPrompt, this.config.timeoutMs);
    const output = await fs.readFile(outputFile, 'utf8').catch(() => '');
    if (result.timedOut) {
      return [
        'Codex Bridge 调用超时。',
        '',
        '消息已写入 Codex Inbox；你可以稍后在当前窗口让我读取 inbox。'
      ].join('\n');
    }
    if (result.exitCode !== 0) {
      logger.warn({ runId, exitCode: result.exitCode, stderr: result.stderr.slice(0, 2000) }, 'codex bridge exec failed');
      return [
        'Codex Bridge 执行失败。',
        result.stderr ? `错误：${result.stderr.slice(0, 1200)}` : '',
        '',
        '消息已写入 Codex Inbox。'
      ].filter(Boolean).join('\n');
    }
    return output.trim() || result.stdout.trim() || 'Codex Bridge 已执行，但没有返回文本。';
  }

  private execArgs(outputFile: string) {
    const args = ['exec', 'resume'];
    if (this.config.session === 'last') {
      args.push('--last');
    } else {
      args.push(this.config.session);
    }
    args.push('--skip-git-repo-check', '--output-last-message', outputFile);
    if (this.config.dangerousBypass) args.push('--dangerously-bypass-approvals-and-sandbox');
    args.push('-');
    return args;
  }

  private helpText() {
    return [
      'Codex Bridge 用法：',
      '',
      '- `/codex 你的消息`：按配置转发给 Codex Bridge',
      '- `/codex inbox 你的消息`：只写入本地 inbox，不启动 Codex',
      '- `/codex exec 你的消息`：请求通过 Codex CLI 执行',
      '- `/codex status`：查看桥接状态'
    ].join('\n');
  }

  private statusText() {
    return [
      'Codex Bridge 状态：',
      `enabled：${this.config.enabled}`,
      `mode：${this.config.mode}`,
      `session：${this.config.session}`,
      `inbox：${path.resolve(this.config.inboxPath)}`,
      `cli：${this.config.cliPath}`
    ].join('\n');
  }
}

function buildTelegramCodexPrompt(prompt: string, context: CodexBridgeContext) {
  return [
    '你收到一条来自 Telegram 的远程消息。请用中文直接回复用户。',
    '除非消息明确要求修改文件或运行命令，否则不要改文件、不要执行命令。',
    '如果涉及付款、密钥、生产部署、删除、外部提交等高风险动作，只说明需要回到 Codex 桌面窗口人工确认。',
    '',
    `Telegram user: ${context.telegramUserId}`,
    `Telegram chat: ${context.chatId}`,
    '',
    '用户消息：',
    prompt
  ].join('\n');
}

function spawnWithInput(command: string, args: string[], input: string, timeoutMs: number) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1000, timeoutMs));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
    child.stdin.end(input);
  });
}

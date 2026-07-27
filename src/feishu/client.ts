import { spawn } from 'node:child_process';
import type { FeishuSendResult } from './types.js';

export class FeishuClient {
  constructor(private readonly cliPath = 'lark-cli') {}

  async sendText(target: { chatId: string } | { userId: string }, text: string): Promise<FeishuSendResult> {
    const args = ['im', '+messages-send'];
    if ('chatId' in target) args.push('--chat-id', target.chatId);
    else args.push('--user-id', target.userId);
    args.push('--as', 'bot', '--text', text);

    const output = await runCli(this.cliPath, args);
    const parsed = parseLastJson(output.stdout);
    const body = unwrapData(parsed);
    const messageId = stringValue(body.message_id) || stringValue(body.messageId);
    if (!messageId) throw new Error(`feishu_send_missing_message_id: ${output.stdout.slice(0, 500)}`);
    return {
      messageId,
      chatId: stringValue(body.chat_id) || stringValue(body.chatId) || undefined,
      createTime: stringValue(body.create_time) || stringValue(body.createTime) || undefined
    };
  }
}

async function runCli(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`lark-cli exited ${code}: ${stderr || stdout}`));
    });
  });
}

function parseLastJson(output: string): Record<string, unknown> {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object') return value as Record<string, unknown>;
    } catch {
      // Keep looking: CLI notices may surround the actual JSON response.
    }
  }
  try {
    const value = JSON.parse(output);
    if (value && typeof value === 'object') return value as Record<string, unknown>;
  } catch {
    // Error below includes a bounded excerpt only; no credentials are printed by this command.
  }
  throw new Error(`invalid_lark_cli_json: ${output.slice(0, 500)}`);
}

function unwrapData(value: Record<string, unknown>) {
  const data = value.data;
  return data && typeof data === 'object' ? data as Record<string, unknown> : value;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

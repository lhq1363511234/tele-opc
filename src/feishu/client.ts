import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FeishuListedMessage, FeishuSendResult } from './types.js';

export interface FeishuDownloadedResource {
  messageId: string;
  key: string;
  type: 'image' | 'file';
  localPath: string;
  sizeBytes: number;
  originalName?: string;
}

export class FeishuClient {
  constructor(private readonly cliPath = 'lark-cli') {}

  async sendText(target: { chatId: string } | { userId: string }, text: string): Promise<FeishuSendResult> {
    const args = ['im', '+messages-send'];
    if ('chatId' in target) args.push('--chat-id', target.chatId);
    else args.push('--user-id', target.userId);
    args.push('--as', 'bot', '--text', text);

    const output = await runCli(this.cliPath, args);
    const body = unwrapData(parseCliJson(output.stdout));
    const messageId = stringValue(body.message_id) || stringValue(body.messageId);
    if (!messageId) throw new Error(`feishu_send_missing_message_id: ${output.stdout.slice(0, 500)}`);
    return {
      messageId,
      chatId: stringValue(body.chat_id) || stringValue(body.chatId) || undefined,
      createTime: stringValue(body.create_time) || stringValue(body.createTime) || undefined
    };
  }

  async listChatMessages(chatId: string, limit = 50): Promise<FeishuListedMessage[]> {
    const output = await runCli(this.cliPath, [
      'im', '+chat-messages-list', '--chat-id', chatId, '--as', 'bot',
      '--order', 'desc', '--page-size', String(Math.max(1, Math.min(limit, 50))),
      '--no-reactions', '--json'
    ]);
    const body = unwrapData(parseCliJson(output.stdout));
    const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
    return messages.map((message) => {
      const sender = isRecord(message.sender) ? message.sender : {};
      return {
        chatId: stringValue(message.chat_id) || chatId,
        content: plainMessageContent(stringValue(message.content)),
        createTime: stringValue(message.create_time),
        messageId: stringValue(message.message_id),
        messageType: stringValue(message.msg_type) || 'text',
        replyTo: stringValue(message.reply_to) || undefined,
        senderId: stringValue(sender.id),
        senderType: stringValue(sender.sender_type)
      };
    }).filter((message) => message.messageId && message.senderId);
  }

  async downloadMessageResources(messageId: string, workingDirectory: string): Promise<{
    resources: FeishuDownloadedResource[];
    message: Record<string, unknown> | null;
  }> {
    await fs.mkdir(workingDirectory, { recursive: true, mode: 0o700 });
    const output = await runCli(
      this.cliPath,
      ['im', '+messages-mget', '--message-ids', messageId, '--as', 'bot', '--no-reactions', '--download-resources', '--json'],
      workingDirectory
    );
    const body = unwrapData(parseCliJson(output.stdout));
    const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
    const message = messages[0] ?? null;
    const declared = message && Array.isArray(message.resources) ? message.resources.filter(isRecord) : [];
    const resources: FeishuDownloadedResource[] = [];

    for (const item of declared) {
      const rawPath = stringValue(item.local_path);
      if (!rawPath || item.error === true) continue;
      const localPath = path.resolve(workingDirectory, rawPath);
      ensureInsideDirectory(workingDirectory, localPath);
      const stat = await fs.stat(localPath);
      if (!stat.isFile()) continue;
      resources.push({
        messageId: stringValue(item.message_id) || messageId,
        key: stringValue(item.key),
        type: item.type === 'image' ? 'image' : 'file',
        localPath,
        sizeBytes: stat.size,
        originalName: originalNameForMessage(message, stringValue(item.key))
      });
    }

    // Older CLI builds may download correctly without attaching `resources` to
    // the JSON response. Fall back to the confined download directory.
    if (!resources.length) {
      const resourceDir = path.join(workingDirectory, 'lark-im-resources');
      for (const localPath of await listRegularFiles(resourceDir)) {
        const stat = await fs.stat(localPath);
        resources.push({
          messageId,
          key: path.basename(localPath),
          type: isImageName(localPath) ? 'image' : 'file',
          localPath,
          sizeBytes: stat.size,
          originalName: originalNameForMessage(message, path.basename(localPath).replace(/\.[^.]+$/, ''))
        });
      }
    }

    return { resources, message };
  }
}

async function runCli(command: string, args: string[], cwd?: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

function plainMessageContent(value: string) {
  return value
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseCliJson(output: string): Record<string, unknown> {
  try {
    const value = JSON.parse(output);
    if (isRecord(value)) return value;
  } catch {
    // Some versions emit informational lines around the JSON document.
  }
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (isRecord(value)) return value;
    } catch {
      // Keep looking.
    }
  }
  throw new Error(`invalid_lark_cli_json: ${output.slice(0, 500)}`);
}

function unwrapData(value: Record<string, unknown>) {
  const data = value.data;
  return isRecord(data) ? data : value;
}

async function listRegularFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile()) files.push(candidate);
      else if (entry.isDirectory()) files.push(...await listRegularFiles(candidate));
    }
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function ensureInsideDirectory(directory: string, candidate: string) {
  const root = `${path.resolve(directory)}${path.sep}`;
  if (!candidate.startsWith(root)) throw new Error('feishu_resource_path_escape');
}


function originalNameForMessage(message: Record<string, unknown> | null, key: string) {
  const content = message ? stringValue(message.content) : '';
  if (!content) return undefined;
  const fileTags = content.matchAll(/<file\s+([^>]+?)\/?\s*>/gi);
  for (const match of fileTags) {
    const attrs = match[1];
    const tagKey = attrs.match(/\bkey="([^"]+)"/i)?.[1] ?? '';
    const name = attrs.match(/\bname="([^"]+)"/i)?.[1] ?? '';
    if (name && (!key || !tagKey || tagKey === key || key.startsWith(tagKey))) return decodeXmlEntities(name);
  }
  return undefined;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isImageName(value: string) {
  return /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { loadConfig } from '../config/index.js';
import { pool } from '../db/pool.js';
import { Repositories } from '../db/repositories.js';
import { logger } from '../logger.js';
import { FeishuClient } from './client.js';
import { FeishuGateway } from './gateway.js';
import { parseFeishuCreateTime, toGatewayEvent } from './polling.js';
import type { FeishuMessageEvent } from './types.js';

const config = loadConfig();
const repos = new Repositories(pool);
const client = new FeishuClient(config.feishu.cliPath);
const gateway = new FeishuGateway(config, repos, client);
const pollFloors = new Map<string, number>();
const seenPolledMessageIds = new Set<string>();
let child: ChildProcessWithoutNullStreams | null = null;
let approvalTimer: NodeJS.Timeout | null = null;
let messagePollTimer: NodeJS.Timeout | null = null;
let messagePollRunning = false;
let stopping = false;

if (!config.feishu.chatEnabled || config.feishu.ownerOpenIds.length === 0) {
  logger.warn({ enabled: config.feishu.chatEnabled, owners: config.feishu.ownerOpenIds.length }, 'Feishu chat gateway disabled');
  await pool.end();
  process.exit(0);
}

async function startConsumer() {
  child = spawn(config.feishu.cliPath, ['event', 'consume', 'im.message.receive_v1', '--as', 'bot'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.on('error', () => undefined);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => logger.info({ output: String(chunk).trim() }, 'lark event consumer'));
  child.on('error', (error) => logger.error({ error }, 'lark event consumer spawn failed'));
  child.on('close', (code, signal) => {
    logger.warn({ code, signal, stopping }, 'lark event consumer exited');
    child = null;
    if (!stopping) setTimeout(() => void startConsumer(), 3000).unref();
  });

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as FeishuMessageEvent;
      await gateway.handleEvent(event);
    } catch (error) {
      logger.error({ error, linePreview: line.slice(0, 300) }, 'Feishu event handling failed');
    }
  }
}

async function pollApprovals() {
  try {
    await gateway.notifyPendingApprovals();
  } catch (error) {
    logger.error({ error }, 'Feishu approval polling failed');
  }
}

async function pollMessages() {
  if (messagePollRunning || stopping) return;
  messagePollRunning = true;
  try {
    const known = await repos.listKnownChannelChats('feishu', config.feishu.ownerOpenIds);
    const chatIds = new Set([
      ...config.feishu.pollChatIds,
      ...known.map((item) => item.external_chat_id)
    ]);
    for (const chatId of chatIds) {
      const floor = pollFloors.get(chatId) ?? Date.now() - 2 * 60 * 1000;
      pollFloors.set(chatId, floor);
      const messages = await client.listChatMessages(chatId, 50);
      const ordered = messages
        .map((message) => ({ message, timestamp: parseFeishuCreateTime(message.createTime) }))
        .filter((item) => item.timestamp >= floor && !seenPolledMessageIds.has(item.message.messageId))
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const item of ordered) {
        if (item.message.senderType !== 'user' || !config.feishu.ownerOpenIds.includes(item.message.senderId)) {
          seenPolledMessageIds.add(item.message.messageId);
          continue;
        }
        await gateway.handleEvent(toGatewayEvent(item.message));
        seenPolledMessageIds.add(item.message.messageId);
      }
    }
    if (seenPolledMessageIds.size > 5000) seenPolledMessageIds.clear();
    if (chatIds.size) logger.debug({ chats: chatIds.size }, 'Feishu message polling fallback completed');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Feishu message polling fallback failed');
  } finally {
    messagePollRunning = false;
  }
}


async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'stopping Feishu gateway');
  if (approvalTimer) clearInterval(approvalTimer);
  if (messagePollTimer) clearInterval(messagePollTimer);
  if (child) child.kill('SIGTERM');
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await pollApprovals();
approvalTimer = setInterval(() => void pollApprovals(), config.feishu.approvalPollIntervalMs);
approvalTimer.unref();
await pollMessages();
messagePollTimer = setInterval(() => void pollMessages(), config.feishu.messagePollIntervalMs);
messagePollTimer.unref();
logger.info({ intervalMs: config.feishu.messagePollIntervalMs }, 'Feishu message polling fallback enabled');
await startConsumer();

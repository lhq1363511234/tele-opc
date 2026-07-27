import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { loadConfig } from '../config/index.js';
import { pool } from '../db/pool.js';
import { Repositories } from '../db/repositories.js';
import { logger } from '../logger.js';
import { FeishuClient } from './client.js';
import { FeishuGateway } from './gateway.js';
import type { FeishuMessageEvent } from './types.js';

const config = loadConfig();
const repos = new Repositories(pool);
const client = new FeishuClient(config.feishu.cliPath);
const gateway = new FeishuGateway(config, repos, client);
let child: ChildProcessWithoutNullStreams | null = null;
let approvalTimer: NodeJS.Timeout | null = null;
let stopping = false;

if (!config.feishu.chatEnabled || config.feishu.ownerOpenIds.length === 0) {
  logger.warn({ enabled: config.feishu.chatEnabled, owners: config.feishu.ownerOpenIds.length }, 'Feishu chat gateway disabled');
  await pool.end();
  process.exit(0);
}

async function startConsumer() {
  child = spawn(config.feishu.cliPath, ['event', 'consume', 'im.message.receive_v1', '--as', 'bot', '--quiet'], {
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

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'stopping Feishu gateway');
  if (approvalTimer) clearInterval(approvalTimer);
  if (child) child.kill('SIGTERM');
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await pollApprovals();
approvalTimer = setInterval(() => void pollApprovals(), config.feishu.approvalPollIntervalMs);
approvalTimer.unref();
await startConsumer();

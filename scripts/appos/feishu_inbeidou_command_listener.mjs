import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const localBaseUrl = (process.env.APPOS_LOCAL_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const outputDirs = {
  inbeidou: process.env.APPOS_INBEIDOU_OUTPUT_DIR || 'runtime/inbeidou-cps-output',
  moboboost: process.env.APPOS_MOBOBOOST_OUTPUT_DIR || 'runtime/moboboost-cps-output'
};
const genericCommandPattern = /(选剧|开始选剧|拉剧)/i;
const moboboostCommandPattern = /(moboboost|mobo|cdreader|ckoc|mckoc|MoboBoost选剧|CDReader选剧)/i;
const inbeidouCommandPattern = /(北斗|北斗智影|inbeidou)/i;
const seenEvents = new Set();

async function readConfiguredChatId() {
  if (process.env.APPOS_FEISHU_CPS_CHAT_ID) return process.env.APPOS_FEISHU_CPS_CHAT_ID;
  try {
    const config = JSON.parse(await readFile(path.join(repoRoot, 'runtime', 'appos-local-config.json'), 'utf8'));
    const feishu = config.dependencies?.find?.((item) => item.id === 'feishu_im');
    return feishu?.env?.chatId || '';
  } catch {
    return '';
  }
}

function larkCliCommand() {
  if (process.platform !== 'win32') return { command: 'lark-cli', args: [] };
  const cliPath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
  return { command: 'node', args: [cliPath] };
}

function extractText(event) {
  const raw = event?.content;
  if (typeof raw !== 'string') return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.text === 'string') return parsed.text.trim();
  } catch {
    // lark-cli sometimes returns already-rendered text.
  }
  return raw.trim();
}

function cpsSourceFromText(text) {
  if (moboboostCommandPattern.test(text)) return 'moboboost';
  if (inbeidouCommandPattern.test(text)) return 'inbeidou';
  if (genericCommandPattern.test(text)) return 'inbeidou';
  return undefined;
}

async function startSelectionCard(chatId, source) {
  const response = await fetch(`${localBaseUrl}/api/appos/cps/${source}/feishu/select/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      sendFeishu: true,
      chatId,
      outputDir: outputDirs[source]
    })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${source} select/start failed: HTTP ${response.status} ${body}`);
  }
  return body;
}

async function main() {
  const targetChatId = await readConfiguredChatId();
  if (!targetChatId) {
    throw new Error('Missing Feishu chat id. Configure feishu_im.env.chatId or APPOS_FEISHU_CPS_CHAT_ID.');
  }

  const cli = larkCliCommand();
  const child = spawn(cli.command, [...cli.args, 'event', 'consume', 'im.message.receive_v1', '--as', 'bot'], {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true
  });

  console.log(`[listener] started chat=${targetChatId} local=${localBaseUrl}`);

  let buffer = '';
  child.stdout.on('data', async (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        console.error(`[listener] invalid event line: ${line.slice(0, 200)}`);
        continue;
      }
      const eventId = event.event_id || event.header?.event_id || event.id || '';
      if (eventId && seenEvents.has(eventId)) continue;
      if (eventId) seenEvents.add(eventId);
      if (seenEvents.size > 500) seenEvents.clear();

      if (event.chat_type === 'group' && event.chat_id !== targetChatId) continue;
      if (event.message_type && event.message_type !== 'text') continue;
      const text = extractText(event);
      const source = cpsSourceFromText(text);
      if (!source) continue;

      try {
        console.log(`[listener] command="${text}" source=${source} chat=${event.chat_id}`);
        const result = await startSelectionCard(event.chat_id, source);
        console.log(`[listener] selection started source=${source} ${result.slice(0, 300)}`);
      } catch (error) {
        console.error(`[listener] command failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  child.on('exit', (code, signal) => {
    console.error(`[listener] lark-cli exited code=${code} signal=${signal || ''}`);
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(`[listener] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});

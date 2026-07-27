import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { z } from 'zod';

dotenv.config({ override: true });

const envBool = (defaultValue: boolean) => z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  return value;
}, z.boolean().default(defaultValue));

const envSchema = z.object({
  APP_ENV: z.string().default('development'),
  APP_NAME: z.string().default('Tele-OPC OS'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  APP_ENCRYPTION_KEY: z.string().default('change-me-use-a-strong-random-key'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().default('postgresql://tele_opc:tele_opc_password@localhost:5432/tele_opc'),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  TELEGRAM_BOT_TOKEN: z.string().default('change-me'),
  TELEGRAM_OWNER_IDS: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  AI_PROVIDER: z.string().default('openai'),
  AI_AGENT_ENABLED: envBool(true),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(60000),
  CODEX_BRIDGE_ENABLED: envBool(false),
  CODEX_BRIDGE_MODE: z.enum(['inbox', 'exec']).default('inbox'),
  CODEX_BRIDGE_CLI_PATH: z.string().default('codex'),
  CODEX_BRIDGE_SESSION: z.string().default('last'),
  CODEX_BRIDGE_TIMEOUT_MS: z.coerce.number().default(180000),
  CODEX_BRIDGE_DANGEROUS_BYPASS: envBool(false),
  CODEX_BRIDGE_INBOX_PATH: z.string().default('runtime/codex-inbox.jsonl'),
  CODEX_BRIDGE_MAX_PROMPT_CHARS: z.coerce.number().default(8000),
  DEFAULT_TIMEZONE: z.string().default('Asia/Shanghai'),
  WEB_CONSOLE_AUTH_MODE: z.enum(['auto', 'open', 'telegram']).default('auto'),
  WEB_CONSOLE_DEV_TOKEN: z.string().default(''),
  APPOS_FEISHU_APP_ID: z.string().default(''),
  APPOS_FEISHU_APP_SECRET: z.string().default(''),
  APPOS_FEISHU_BASE_APP_TOKEN: z.string().default(''),
  APPOS_FEISHU_OPEN_BASE_URL: z.string().default('https://open.feishu.cn/open-apis'),
  APPOS_FEISHU_MIRROR_ENABLED: envBool(false),
  APPOS_FEISHU_AUTO_SYNC_INTERVAL_MS: z.coerce.number().int().min(15000).max(86400000).default(60000),
  FEISHU_CHAT_ENABLED: envBool(false),
  FEISHU_OWNER_OPEN_IDS: z.string().default(''),
  FEISHU_CLI_PATH: z.string().default('lark-cli'),
  FEISHU_APPROVAL_POLL_INTERVAL_MS: z.coerce.number().int().min(3000).max(300000).default(10000),
  FEISHU_MESSAGE_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(15000),
  FEISHU_POLL_CHAT_IDS: z.string().default(''),
  FEISHU_ATTACHMENT_MAX_BYTES: z.coerce.number().int().min(1048576).max(536870912).default(52428800),
  WECHAT_ILINK_ENABLED: envBool(false),
  WECHAT_ILINK_BASE_URL: z.string().default('https://ilinkai.weixin.qq.com'),
  WECHAT_ILINK_RETRY_DELAY_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  WECHAT_ILINK_REPLY_MODE: z.enum(['approval', 'auto']).default('approval'),
  PAPERCLIP_ENABLED: envBool(false),
  PAPERCLIP_API_URL: z.string().default('http://127.0.0.1:3101'),
  PAPERCLIP_API_KEY: z.string().default(''),
  PAPERCLIP_COMPANY_ID: z.string().default(''),
  PAPERCLIP_WEBHOOK_SECRET: z.string().default(''),
  PAPERCLIP_HEARTBEAT_WAIT_MS: z.coerce.number().int().min(0).max(900000).default(12000)
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = envSchema.parse(process.env);
  const configPath = path.resolve(process.cwd(), 'config', 'tele-opc.yaml');
  const exampleConfigPath = path.resolve(process.cwd(), 'config', 'tele-opc.example.yaml');
  const yamlPath = fs.existsSync(configPath) ? configPath : exampleConfigPath;
  const yamlConfig = fs.existsSync(yamlPath)
    ? (YAML.parse(fs.readFileSync(yamlPath, 'utf8')) as Record<string, unknown>)
    : {};

  const telegramOwnerIds = env.TELEGRAM_OWNER_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  const feishuOwnerOpenIds = env.FEISHU_OWNER_OPEN_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const feishuPollChatIds = env.FEISHU_POLL_CHAT_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    app: {
      env: env.APP_ENV,
      name: env.APP_NAME,
      host: env.HOST,
      port: env.PORT,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      encryptionKey: env.APP_ENCRYPTION_KEY,
      logLevel: env.LOG_LEVEL,
      timezone: env.DEFAULT_TIMEZONE
    },
    webConsole: {
      authMode: env.WEB_CONSOLE_AUTH_MODE,
      devToken: env.WEB_CONSOLE_DEV_TOKEN
    },
    feishu: {
      appId: env.APPOS_FEISHU_APP_ID,
      appSecret: env.APPOS_FEISHU_APP_SECRET,
      baseAppToken: env.APPOS_FEISHU_BASE_APP_TOKEN,
      openBaseUrl: env.APPOS_FEISHU_OPEN_BASE_URL,
      mirrorEnabled: env.APPOS_FEISHU_MIRROR_ENABLED,
      autoSyncIntervalMs: env.APPOS_FEISHU_AUTO_SYNC_INTERVAL_MS,
      chatEnabled: env.FEISHU_CHAT_ENABLED,
      ownerOpenIds: feishuOwnerOpenIds,
      cliPath: env.FEISHU_CLI_PATH,
      approvalPollIntervalMs: env.FEISHU_APPROVAL_POLL_INTERVAL_MS,
      messagePollIntervalMs: env.FEISHU_MESSAGE_POLL_INTERVAL_MS,
      pollChatIds: feishuPollChatIds,
      attachmentMaxBytes: env.FEISHU_ATTACHMENT_MAX_BYTES
    },
    wechatIlink: {
      enabled: env.WECHAT_ILINK_ENABLED,
      baseUrl: env.WECHAT_ILINK_BASE_URL,
      retryDelayMs: env.WECHAT_ILINK_RETRY_DELAY_MS,
      replyMode: env.WECHAT_ILINK_REPLY_MODE
    },
    paperclip: {
      enabled: env.PAPERCLIP_ENABLED,
      apiUrl: env.PAPERCLIP_API_URL,
      apiKey: env.PAPERCLIP_API_KEY,
      companyId: env.PAPERCLIP_COMPANY_ID,
      webhookSecret: env.PAPERCLIP_WEBHOOK_SECRET,
      heartbeatWaitMs: env.PAPERCLIP_HEARTBEAT_WAIT_MS
    },
    database: {
      url: env.DATABASE_URL
    },
    redis: {
      url: env.REDIS_URL
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      ownerIds: telegramOwnerIds,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET
    },
    ai: {
      provider: env.AI_PROVIDER,
      agentEnabled: env.AI_AGENT_ENABLED,
      openaiBaseUrl: env.OPENAI_BASE_URL,
      openaiApiKey: env.OPENAI_API_KEY,
      openaiModel: env.OPENAI_MODEL,
      openaiTimeoutMs: env.OPENAI_TIMEOUT_MS
    },
    codexBridge: {
      enabled: env.CODEX_BRIDGE_ENABLED,
      mode: env.CODEX_BRIDGE_MODE,
      cliPath: env.CODEX_BRIDGE_CLI_PATH,
      session: env.CODEX_BRIDGE_SESSION,
      timeoutMs: env.CODEX_BRIDGE_TIMEOUT_MS,
      dangerousBypass: env.CODEX_BRIDGE_DANGEROUS_BYPASS,
      inboxPath: env.CODEX_BRIDGE_INBOX_PATH,
      maxPromptChars: env.CODEX_BRIDGE_MAX_PROMPT_CHARS
    },
    yaml: yamlConfig
  };
}

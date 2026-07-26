import { describe, expect, it } from 'vitest';
import { createWebConsoleAuthPreHandler, resolveWebConsoleAuthMode } from '../src/web/auth.js';
import type { AppConfig } from '../src/config/index.js';

function config(partial: Partial<AppConfig['app']> & { authMode?: 'auto' | 'open' | 'telegram'; devToken?: string } = {}): AppConfig {
  return {
    app: {
      env: partial.env ?? 'production',
      name: 'Tele-OPC OS',
      host: '0.0.0.0',
      port: 3000,
      publicBaseUrl: 'http://localhost:3000',
      encryptionKey: 'test',
      logLevel: 'info',
      timezone: 'Asia/Shanghai'
    },
    webConsole: {
      authMode: partial.authMode ?? 'auto',
      devToken: partial.devToken ?? ''
    },
    database: { url: 'postgresql://localhost/test' },
    redis: { url: 'redis://localhost:6379/0' },
    telegram: {
      botToken: 'change-me',
      ownerIds: [123],
      webhookSecret: ''
    },
    ai: {
      provider: 'openai',
      agentEnabled: true,
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: '',
      openaiModel: 'gpt-4.1',
      openaiTimeoutMs: 60000
    },
    codexBridge: {
      enabled: false,
      mode: 'inbox',
      cliPath: 'codex',
      session: 'last',
      timeoutMs: 1000,
      dangerousBypass: false,
      inboxPath: 'runtime/codex-inbox.jsonl',
      maxPromptChars: 1000
    },
    paperclip: { enabled: false, apiUrl: 'http://127.0.0.1:3101', apiKey: '', companyId: '', webhookSecret: '', heartbeatWaitMs: 12000 },
    feishu: {
      appId: '',
      appSecret: '',
      baseAppToken: '',
      openBaseUrl: 'https://open.feishu.cn/open-apis',
      mirrorEnabled: false,
      autoSyncIntervalMs: 60000
    },
    yaml: {}
  };
}

describe('web console auth', () => {
  it('resolves auto mode by environment', () => {
    expect(resolveWebConsoleAuthMode(config({ env: 'development', authMode: 'auto' }))).toBe('open');
    expect(resolveWebConsoleAuthMode(config({ env: 'production', authMode: 'auto' }))).toBe('telegram');
  });

  it('allows open mode without credentials', async () => {
    const preHandler = createWebConsoleAuthPreHandler(config({ authMode: 'open' }));
    let sent: unknown = null;
    const reply = {
      code(status: number) {
        this.status = status;
        return this;
      },
      send(payload: unknown) {
        sent = payload;
        return payload;
      },
      status: 200
    };
    await preHandler({ headers: {} } as any, reply as any);
    expect(sent).toBeNull();
    expect(reply.status).toBe(200);
  });

  it('rejects production telegram mode without init data', async () => {
    const preHandler = createWebConsoleAuthPreHandler(config({ authMode: 'telegram' }));
    let sent: any = null;
    const reply = {
      code(status: number) {
        this.status = status;
        return this;
      },
      send(payload: unknown) {
        sent = payload;
        return payload;
      },
      status: 200
    };
    const result = await preHandler({ headers: {} } as any, reply as any);
    expect(reply.status).toBe(401);
    expect(sent.error).toBe('web_console_unauthorized');
    expect(result).toEqual(sent);
  });

  it('allows configured dev token bypass', async () => {
    const preHandler = createWebConsoleAuthPreHandler(config({ authMode: 'telegram', devToken: 'secret-token' }));
    let sent: unknown = null;
    const reply = {
      code(status: number) {
        this.status = status;
        return this;
      },
      send(payload: unknown) {
        sent = payload;
        return payload;
      },
      status: 200
    };
    await preHandler({ headers: { 'x-tele-opc-dev-token': 'secret-token' } } as any, reply as any);
    expect(sent).toBeNull();
    expect(reply.status).toBe(200);
  });
});

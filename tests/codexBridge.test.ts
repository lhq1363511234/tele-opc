import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexBridge, parseCodexBridgeCommand } from '../src/codex/codexBridge.js';

describe('CodexBridge', () => {
  it('parses Telegram bridge commands', () => {
    expect(parseCodexBridgeCommand('/codex')).toEqual({ mode: 'help' });
    expect(parseCodexBridgeCommand('/codex status')).toEqual({ mode: 'status' });
    expect(parseCodexBridgeCommand('/codex inbox 记一下')).toEqual({ mode: 'inbox', prompt: '记一下' });
    expect(parseCodexBridgeCommand('/codex exec 帮我看 bug')).toEqual({ mode: 'exec', prompt: '帮我看 bug' });
    expect(parseCodexBridgeCommand('/codex 帮我看 bug')).toEqual({ mode: 'default', prompt: '帮我看 bug' });
    expect(parseCodexBridgeCommand('/tasks')).toBeNull();
  });

  it('writes inbox messages without executing Codex in inbox mode', async () => {
    const inboxPath = path.resolve('runtime', `codex-bridge-test-${Date.now()}.jsonl`);
    const bridge = new CodexBridge({
      enabled: true,
      mode: 'inbox',
      cliPath: 'codex-not-called',
      session: 'last',
      timeoutMs: 1000,
      dangerousBypass: false,
      inboxPath,
      maxPromptChars: 8000
    });

    const reply = await bridge.handle({ mode: 'default', prompt: '从 Telegram 投递' }, {
      telegramUserId: 123,
      chatId: 'chat_123',
      messageId: 'msg_123'
    });

    expect(reply).toContain('已投递到 Codex Inbox');
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).toContain('从 Telegram 投递');
    expect(content).toContain('msg_123');
    await fs.rm(inboxPath, { force: true });
  });
});

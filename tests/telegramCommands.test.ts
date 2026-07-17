import { describe, expect, it } from 'vitest';
import { TELEGRAM_BOT_COMMANDS } from '../src/telegram/commands.js';

describe('TELEGRAM_BOT_COMMANDS', () => {
  it('uses Telegram-compatible command names and descriptions', () => {
    const names = new Set<string>();

    for (const command of TELEGRAM_BOT_COMMANDS) {
      expect(command.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(256);
      expect(names.has(command.command)).toBe(false);
      names.add(command.command);
    }
  });

  it('keeps the owner command menu focused on high-frequency Telegram actions', () => {
    expect(TELEGRAM_BOT_COMMANDS.map((command) => command.command)).toEqual(
      ['start', 'new', 'tasks', 'next', 'approvals', 'help']
    );
  });

  it('moves advanced V3 Agent OS operations behind cards and the web console', () => {
    const visibleCommands = TELEGRAM_BOT_COMMANDS.map((command) => command.command);
    expect(visibleCommands).not.toContain('agents');
    expect(visibleCommands).not.toContain('settings');
    expect(visibleCommands).not.toContain('crm');
    expect(visibleCommands).not.toContain('finance');
    expect(TELEGRAM_BOT_COMMANDS).toHaveLength(6);
  });
});

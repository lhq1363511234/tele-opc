import { beforeEach, describe, expect, it, vi } from 'vitest';

const { telegramFetchMock } = vi.hoisted(() => ({
  telegramFetchMock: vi.fn()
}));

vi.mock('../src/telegram/fetch.js', () => ({
  telegramFetch: telegramFetchMock
}));

import { sanitizeTelegramPlainText, splitTelegramMessage, TelegramClient } from '../src/telegram/client.js';

describe('TelegramClient', () => {
  beforeEach(() => {
    telegramFetchMock.mockReset();
  });

  it('sends plain text by default and includes inline keyboards', async () => {
    telegramFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } })
    });

    const client = new TelegramClient('token');
    const result = await client.sendMessage(123, '`T12` **任务**', {
      replyMarkup: {
        inline_keyboard: [[{ text: '查看详情', callback_data: 't:v:tsk_1' }]]
      }
    });

    expect(result).toMatchObject({ ok: true });
    expect(telegramFetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(telegramFetchMock.mock.calls[0][1].body);
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toBe('T12 任务');
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({ text: '查看详情', callback_data: 't:v:tsk_1' });
  });

  it('splits long messages on line boundaries', () => {
    const chunks = splitTelegramMessage(['first line', 'second line', 'third line'].join('\n'), 22);

    expect(chunks).toEqual(['first line\nsecond line', 'third line']);
  });

  it('sanitizes common Markdown artifacts for plain Telegram text', () => {
    expect(sanitizeTelegramPlainText('查看 `/task T12` 和 **详情**')).toBe('查看 /task T12 和 详情');
  });
});

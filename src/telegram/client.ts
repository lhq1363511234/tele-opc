import { logger } from '../logger.js';
import { telegramFetch } from './fetch.js';

const TELEGRAM_MESSAGE_CHUNK_SIZE = 3600;

export type TelegramParseMode = 'HTML' | 'MarkdownV2' | 'Markdown';

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: {
    url: string;
  };
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: Array<Array<string | { text: string; web_app?: { url: string } }>>;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
}

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;

export interface TelegramSendMessageOptions {
  replyMarkup?: TelegramReplyMarkup;
  parseMode?: TelegramParseMode;
  disableWebPagePreview?: boolean;
}

export interface TelegramFileInfo {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export class TelegramClient {
  constructor(private readonly botToken: string) {}

  async sendMessage(chatId: number, text: string, options: TelegramSendMessageOptions = {}) {
    if (!this.botToken || this.botToken === 'change-me') {
      logger.warn({ chatId, text }, 'telegram token not configured; skipped sendMessage');
      return { ok: false, skipped: true };
    }

    const outgoingText = options.parseMode ? text : sanitizeTelegramPlainText(text);
    const chunks = splitTelegramMessage(outgoingText);
    const results: unknown[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const result = await this.postMessage(chatId, chunk, {
        ...options,
        replyMarkup: index === chunks.length - 1 ? options.replyMarkup : undefined
      });
      if (result.ok) {
        results.push(result.body);
        continue;
      }

      if (options.parseMode && isTelegramEntityParseError(result.bodyText)) {
        logger.warn({ status: result.status, body: result.bodyText }, 'telegram parse failed; retrying as plain text');
        const plainResult = await this.postMessage(chatId, chunk, {
          ...options,
          parseMode: undefined,
          replyMarkup: index === chunks.length - 1 ? options.replyMarkup : undefined
        });
        results.push(plainResult.ok ? plainResult.body : { ok: false, status: plainResult.status, body: plainResult.bodyText });
        continue;
      }

      logger.error({ status: result.status, body: result.bodyText }, 'telegram sendMessage failed');
      results.push({ ok: false, status: result.status, body: result.bodyText });
    }

    return chunks.length === 1 ? results[0] : { ok: true, results };
  }

  async editMessageText(chatId: number, messageId: number, text: string, options: TelegramSendMessageOptions = {}) {
    if (!this.botToken || this.botToken === 'change-me') {
      logger.warn({ chatId, messageId, text }, 'telegram token not configured; skipped editMessageText');
      return { ok: false, skipped: true };
    }

    return this.postJson('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.disableWebPagePreview ? { disable_web_page_preview: true } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
    });
  }

  async editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup?: TelegramReplyMarkup) {
    if (!this.botToken || this.botToken === 'change-me') {
      logger.warn({ chatId, messageId }, 'telegram token not configured; skipped editMessageReplyMarkup');
      return { ok: false, skipped: true };
    }

    return this.postJson('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup ?? { inline_keyboard: [] }
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
    if (!this.botToken || this.botToken === 'change-me') {
      logger.warn({ callbackQueryId }, 'telegram token not configured; skipped answerCallbackQuery');
      return { ok: false, skipped: true };
    }

    return this.postJson('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
      ...(showAlert ? { show_alert: true } : {})
    });
  }

  async sendChatAction(chatId: number, action: 'typing' | 'upload_photo' | 'upload_document' | 'record_voice' = 'typing') {
    if (!this.botToken || this.botToken === 'change-me') {
      return { ok: false, skipped: true };
    }

    return this.postJson('sendChatAction', {
      chat_id: chatId,
      action
    });
  }

  async getFile(fileId: string) {
    if (!this.botToken || this.botToken === 'change-me') {
      return null;
    }

    const result = await this.postJson('getFile', {
      file_id: fileId
    });
    if (!result.ok || !result.body || typeof result.body !== 'object') return null;
    const body = result.body as { result?: TelegramFileInfo };
    return body.result ?? null;
  }

  async downloadFile(fileId: string) {
    const file = await this.getFile(fileId);
    if (!file?.file_path) return null;

    const response = await telegramFetch(`https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`);
    if (!response.ok) {
      const body = await response.text();
      logger.warn({ status: response.status, body }, 'telegram file download failed');
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return { file, bytes };
  }

  private async postMessage(chatId: number, text: string, options: TelegramSendMessageOptions) {
    return this.postJson('sendMessage', {
      chat_id: chatId,
      text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.disableWebPagePreview ? { disable_web_page_preview: true } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
    });
  }

  private async postJson(method: string, body: Record<string, unknown>) {
    const response = await telegramFetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, status: response.status, bodyText: body };
    }

    return { ok: true, body: (await response.json()) as unknown };
  }
}

export function splitTelegramMessage(text: string, maxLength = TELEGRAM_MESSAGE_CHUNK_SIZE) {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (line.length <= maxLength) {
      current = line;
      continue;
    }

    for (let index = 0; index < line.length; index += maxLength) {
      chunks.push(line.slice(index, index + maxLength));
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function sanitizeTelegramPlainText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, ''))
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, '$1: $2')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function isTelegramEntityParseError(bodyText?: string) {
  return /can't parse entities/i.test(bodyText ?? '');
}

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { getTelegramInitDataValidation } from './telegramInitData.js';

export type WebConsoleAuthMode = 'open' | 'telegram' | 'auto';

export function resolveWebConsoleAuthMode(config: AppConfig): Exclude<WebConsoleAuthMode, 'auto'> {
  if (config.webConsole.authMode === 'open') return 'open';
  if (config.webConsole.authMode === 'telegram') return 'telegram';
  return config.app.env === 'development' || config.app.env === 'test' ? 'open' : 'telegram';
}

export function createWebConsoleAuthPreHandler(config: AppConfig) {
  const mode = resolveWebConsoleAuthMode(config);

  return async function allowWebConsoleAccess(request: FastifyRequest, reply: FastifyReply) {
    if (mode === 'open') {
      return;
    }

    const devToken = config.webConsole.devToken;
    const providedDevToken = headerValue(request.headers['x-tele-opc-dev-token']);
    if (devToken && providedDevToken && safeEqual(providedDevToken, devToken)) {
      return;
    }

    const initData = getTelegramInitDataValidation(request, config);
    if (initData.valid) {
      return;
    }

    reply.code(401);
    return reply.send({
      ok: false,
      error: 'web_console_unauthorized',
      reason: initData.reason,
      authMode: mode,
      hint: 'Provide a valid Telegram Mini App initData via x-telegram-init-data, or a configured x-tele-opc-dev-token.'
    });
  };
}

function headerValue(value: string | string[] | undefined) {
  const token = Array.isArray(value) ? value[0] : value;
  return token?.trim() || null;
}

function safeEqual(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) {
    mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

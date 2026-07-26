import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/index.js';

export type TelegramInitDataValidation = {
  present: boolean;
  valid: boolean;
  reason: string;
  userId?: number;
  ownerAllowed?: boolean;
  authDate?: number;
  ageSeconds?: number | null;
  queryId?: string;
  startParam?: string;
};

export function getTelegramInitDataValidation(
  request: FastifyRequest,
  config: AppConfig
): TelegramInitDataValidation {
  const initData = tokenFromHeader(request.headers['x-telegram-init-data']);
  if (!initData) {
    return { present: false, valid: false, reason: 'missing_init_data' };
  }
  if (!config.telegram.botToken || config.telegram.botToken === 'change-me') {
    return { present: true, valid: false, reason: 'bot_token_missing' };
  }
  if (!config.telegram.ownerIds.length) {
    return { present: true, valid: false, reason: 'owner_ids_missing' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { present: true, valid: false, reason: 'hash_missing' };
  }
  params.delete('hash');

  const authDate = Number(params.get('auth_date') ?? 0);
  const ageSeconds = authDate ? Math.floor(Date.now() / 1000 - authDate) : null;
  if (!authDate) {
    return { present: true, valid: false, reason: 'auth_date_missing' };
  }
  if (ageSeconds !== null && ageSeconds > 24 * 60 * 60) {
    return { present: true, valid: false, reason: 'auth_date_expired', authDate, ageSeconds };
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeTokenEqual(hash, expected)) {
    return { present: true, valid: false, reason: 'hash_mismatch', authDate, ageSeconds };
  }

  const userParam = params.get('user');
  if (!userParam) {
    return { present: true, valid: false, reason: 'user_missing', authDate, ageSeconds };
  }

  try {
    const user = JSON.parse(userParam) as { id?: unknown };
    const userId = typeof user.id === 'number' ? user.id : undefined;
    const ownerAllowed = typeof userId === 'number' && config.telegram.ownerIds.includes(userId);
    return {
      present: true,
      valid: ownerAllowed,
      reason: ownerAllowed ? 'ok' : 'owner_not_allowed',
      userId,
      ownerAllowed,
      authDate,
      ageSeconds,
      queryId: params.get('query_id') ?? undefined,
      startParam: params.get('start_param') ?? undefined
    };
  } catch {
    return { present: true, valid: false, reason: 'user_parse_failed', authDate, ageSeconds };
  }
}

function tokenFromHeader(value: string | string[] | undefined) {
  const token = Array.isArray(value) ? value[0] : value;
  return token?.trim() || null;
}

function safeTokenEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

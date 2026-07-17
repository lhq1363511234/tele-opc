import type { TelegramUser } from '../telegram/types.js';

export function isOwnerAllowed(user: TelegramUser | undefined, ownerIds: number[]) {
  if (!user) return false;
  return ownerIds.includes(user.id);
}


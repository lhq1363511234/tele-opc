import type { ChannelMessage } from '../contracts/types.js';

export type { ChannelMessage };

export const nowIso = () => new Date().toISOString();

export const msTimestampToIso = (value: unknown) => {
  const numeric = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(numeric) ? new Date(numeric).toISOString() : nowIso();
};

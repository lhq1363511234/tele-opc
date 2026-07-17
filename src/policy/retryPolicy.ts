import type { TaskStatus } from '../types.js';

export const retryableTaskStatuses = ['failed', 'blocked', 'waiting_external', 'planned'] as const;

export function isRetryableTaskStatus(status: TaskStatus) {
  return (retryableTaskStatuses as readonly string[]).includes(status);
}

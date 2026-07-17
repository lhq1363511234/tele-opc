import { describe, expect, it } from 'vitest';
import { taskJobId } from '../src/queue/taskQueue.js';

describe('taskQueue', () => {
  it('builds BullMQ custom job ids without colon separators', () => {
    const id = taskJobId({
      taskId: 'tsk_123:bad/value',
      source: 'retry'
    });

    expect(id).toBe('task-retry-tsk_123-bad-value');
    expect(id).not.toContain(':');
  });
});

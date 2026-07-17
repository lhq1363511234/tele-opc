import { describe, expect, it } from 'vitest';
import { createReviewDraft } from '../src/review/reviewIntake.js';
import type { TaskRecord } from '../src/types.js';

describe('createReviewDraft', () => {
  it('detects successful reusable work as a playbook candidate', () => {
    const draft = createReviewDraft(task({ status: 'done' }), '已完成，结果达标。下次应该沉淀为标准流程复用。');

    expect(draft.resultMet).toBe(true);
    expect(draft.playbookCandidate).toContain('适用任务');
    expect(draft.nextActions.join('\n')).toContain('沉淀');
  });

  it('creates recovery next actions for failed work', () => {
    const draft = createReviewDraft(task({ status: 'failed' }), '未达标，客户上下文不足。');

    expect(draft.resultMet).toBe(false);
    expect(draft.nextActions).toEqual(['补充上下文并重新拆解任务。']);
  });
});

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'tsk_1',
    title: '测试任务',
    description: null,
    origin_message_id: null,
    parent_task_id: null,
    owner_agent: 'chief_of_staff',
    priority: 'normal',
    risk_level: 'low',
    status: 'done',
    sequence: null,
    planning_metadata: {},
    result: null,
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    ...overrides
  };
}

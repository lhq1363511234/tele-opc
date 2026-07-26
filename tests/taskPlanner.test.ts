import { describe, expect, it } from 'vitest';
import { createTaskPlan } from '../src/planner/taskPlanner.js';

describe('createTaskPlan', () => {
  it('creates steps from an explicitly numbered step list', () => {
    const plan = createTaskPlan('帮我规划一个客户跟进流程：\n1. 整理客户名单\n2. 起草跟进邮件\n3. 安排会议');

    expect(plan?.steps.map((step) => step.title)).toEqual(['整理客户名单', '起草跟进邮件', '安排会议']);
    expect(plan?.steps.map((step) => step.ownerAgent)).toEqual(['crm', 'email', 'calendar']);
  });

  it('does not shred prose into fragments on punctuation', () => {
    const plan = createTaskPlan('目标：明天之前必须挣到 100 元，不是演练，要可执行的第一步');

    // The old planner split this into "不是演练" / "要可执行的第一步" style fragments.
    expect(plan?.steps.some((step) => step.title === '不是演练') ?? false).toBe(false);
  });

  it('creates domain steps for multi-domain operating plans', () => {
    const plan = createTaskPlan('帮我规划一个 CRM、邮件、财务、日历和浏览器自动化的运营流程');

    expect(plan?.steps.map((step) => step.ownerAgent)).toEqual(['crm', 'email', 'finance', 'calendar', 'browser']);
  });
});

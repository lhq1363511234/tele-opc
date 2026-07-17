import { describe, expect, it } from 'vitest';
import { createTaskPlan } from '../src/planner/taskPlanner.js';

describe('createTaskPlan', () => {
  it('creates steps from delimited planning requests', () => {
    const plan = createTaskPlan('帮我规划一个客户跟进流程：整理客户名单、起草跟进邮件、安排会议');

    expect(plan?.steps.map((step) => step.title)).toEqual(['整理客户名单', '起草跟进邮件', '安排会议']);
    expect(plan?.steps.map((step) => step.ownerAgent)).toEqual(['crm', 'email', 'calendar']);
  });

  it('creates domain steps for multi-domain operating plans', () => {
    const plan = createTaskPlan('帮我规划一个 CRM、邮件、财务、日历和浏览器自动化的运营流程');

    expect(plan?.steps.map((step) => step.ownerAgent)).toEqual(['crm', 'email', 'finance', 'calendar', 'browser']);
  });
});

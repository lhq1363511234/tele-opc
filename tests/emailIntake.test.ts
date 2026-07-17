import { describe, expect, it } from 'vitest';
import { classifyEmail, isMailDashboardRequest, parseEmailRecordInstruction } from '../src/email/emailIntake.js';

describe('email intake', () => {
  it('parses manually recorded customer emails', () => {
    const result = parseEmailRecordInstruction(
      '记录邮件 Jane <jane@acme.com> 主题：企业版咨询 正文：客户想了解报价，需要回复。'
    );

    expect(result).toMatchObject({
      fromName: 'Jane',
      fromAddress: 'jane@acme.com',
      subject: '企业版咨询',
      category: 'customer',
      needsFollowUp: true
    });
    expect(result?.body).toContain('客户想了解报价');
  });

  it('classifies operational email categories', () => {
    expect(classifyEmail('紧急：请尽快回复报价')).toBe('urgent');
    expect(classifyEmail('发票和付款账单')).toBe('finance');
    expect(classifyEmail('会议时间和 calendar invite')).toBe('calendar');
    expect(classifyEmail('newsletter 周报')).toBe('newsletter');
    expect(classifyEmail('unsubscribe spam')).toBe('ignored');
  });

  it('detects mail dashboard requests', () => {
    expect(isMailDashboardRequest('帮我分拣收件箱。')).toBe(true);
    expect(isMailDashboardRequest('帮我看看最近哪些客户邮件需要跟进。')).toBe(true);
    expect(isMailDashboardRequest('今天的任务是什么？')).toBe(false);
  });
});

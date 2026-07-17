import { describe, expect, it } from 'vitest';
import { intakeMessage } from '../src/intake/intake.js';

describe('intakeMessage', () => {
  it('detects telegram commands', () => {
    const result = intakeMessage('/today');
    expect(result.kind).toBe('command');
    expect(result.riskLevel).toBe('low');
  });

  it('treats normal customer email drafts as low-risk V3 tasks', () => {
    const result = intakeMessage('帮我准备一封给 Alice 的跟进邮件，但不要直接发送。');
    expect(result.kind).toBe('task');
    expect(result.riskLevel).toBe('low');
    expect(result.requiredApprovalAction).toBeUndefined();
    expect(result.reasons).toHaveLength(0);
  });

  it('treats bulk cold email as an auto-runnable task in V3', () => {
    const result = intakeMessage('帮我批量群发 500 封冷邮件。');
    expect(result.kind).toBe('task');
    expect(result.riskLevel).toBe('low');
    expect(result.requiredApprovalAction).toBeUndefined();
    expect(result.reasons).toHaveLength(0);
  });

  it('detects high-risk non-email bulk outreach tasks', () => {
    const result = intakeMessage('帮我批量群发 500 条私信。');
    expect(result.kind).toBe('task');
    expect(result.riskLevel).toBe('high');
    expect(result.requiredApprovalAction).toBe('bulk_non_email_outreach');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('treats normal analysis as a low-risk task', () => {
    const result = intakeMessage('帮我分析这个月的任务完成情况');
    expect(result.kind).toBe('task');
    expect(result.riskLevel).toBe('low');
  });

  it('treats planning requests as tasks', () => {
    const result = intakeMessage('帮我规划一个客户跟进流程');
    expect(result.kind).toBe('task');
  });
});

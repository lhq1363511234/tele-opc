import { describe, expect, it } from 'vitest';
import { isCalendarDashboardRequest, parseCalendarInstruction } from '../src/calendar/calendarIntake.js';

describe('calendar intake', () => {
  it('parses manually recorded meetings', () => {
    const result = parseCalendarInstruction(
      '记录会议 2026-06-12 10:00 和 Alice 讨论企业版 demo，需要准备资料，时长 30 分钟。'
    );

    expect(result).toMatchObject({
      title: '客户 demo',
      startsAt: '2026-06-12T10:00:00.000+08:00',
      attendees: ['Alice'],
      needsPrep: true
    });
    expect(result?.endsAt).toBe('2026-06-12T02:30:00.000Z');
  });

  it('detects calendar dashboard requests', () => {
    expect(isCalendarDashboardRequest('明天哪些会议需要准备？')).toBe(true);
    expect(isCalendarDashboardRequest('打开日历看板')).toBe(true);
    expect(isCalendarDashboardRequest('这个月现金流怎么样？')).toBe(false);
  });
});

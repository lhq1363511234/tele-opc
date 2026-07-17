import { describe, expect, it } from 'vitest';
import {
  parseTelegramApprovalCallback,
  telegramApprovalCallbackToEvent,
  renderTelegramApprovalCard,
  renderTelegramTaskStatusCard
} from '../../src/appos/cards/telegram-card-renderer.js';

describe('Telegram AppOS cards', () => {
  it('renders a compact task status card', () => {
    const card = renderTelegramTaskStatusCard({
      id: 'T12',
      title: '旺仔牛奶宣传 PPT',
      status: 'running',
      currentStep: '3/6 设计叙事结构',
      previewUrl: 'https://example.com/preview'
    });

    expect(card.text).toContain('T12');
    expect(card.reply_markup.inline_keyboard.flat().map((button) => button.text)).toContain('打开预览');
  });

  it('renders and parses approval callbacks', () => {
    const card = renderTelegramApprovalCard({
      approvalId: 'appr_001',
      title: '发布 CPS 短视频',
      riskLevel: 'medium',
      reason: '外部发布需要审批'
    });

    const approve = card.reply_markup.inline_keyboard[0][0].callback_data;
    expect(approve).toBeDefined();
    expect(parseTelegramApprovalCallback(approve!)).toEqual({ approvalId: 'appr_001', decision: 'approved' });
  });

  it('turns approval callbacks into application events', () => {
    const event = telegramApprovalCallbackToEvent('appos:approval:appr_001:approved', '2026-06-24T01:30:00.000Z');

    expect(event?.eventType).toBe('approval_approved');
    expect(event?.localObjectId).toBe('appr_001');
  });
});

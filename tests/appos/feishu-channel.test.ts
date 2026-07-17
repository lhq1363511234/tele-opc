import { describe, expect, it } from 'vitest';
import {
  createBusinessContractFromChannelMessage,
  normalizeFeishuEvent,
  renderFeishuStatusCard
} from '../../src/appos/channels/feishu.js';

describe('Feishu AppOS channel', () => {
  it('normalizes a Feishu text event into a channel message', () => {
    const message = normalizeFeishuEvent({
      event_id: 'evt_feishu_001',
      event: {
        message: {
          message_id: 'om_001',
          chat_id: 'oc_001',
          content: JSON.stringify({ text: '做一个 CPS 矩阵内容任务' }),
          create_time: '1719192000000'
        },
        sender: {
          sender_id: { open_id: 'ou_owner' },
          sender_type: 'user'
        }
      }
    });

    expect(message.channel).toBe('feishu');
    expect(message.text).toContain('CPS');
    expect(message.rawEventRef).toBe('feishu:event:evt_feishu_001');
  });

  it('creates a social distribution business contract from a Feishu message', () => {
    const message = normalizeFeishuEvent({
      event_id: 'evt_feishu_002',
      event: {
        message: {
          message_id: 'om_002',
          chat_id: 'oc_002',
          content: JSON.stringify({ text: '帮我做小红书和抖音 CPS 矩阵' }),
          create_time: '1719192000000'
        },
        sender: {
          sender_id: { open_id: 'ou_owner' }
        }
      }
    });

    const contract = createBusinessContractFromChannelMessage(message);

    expect(contract.sourceIntentPacketId).toBe('feishu:om_002');
    expect(contract.domain).toBe('social_distribution');
    expect(contract.approvalRequired).toBe(true);
  });

  it('renders a Feishu status card payload', () => {
    const card = renderFeishuStatusCard({
      title: 'CPS 矩阵任务',
      status: 'planned',
      summary: '已创建 BusinessContract',
      links: [{ text: '打开 Base', url: 'https://example.com/base' }]
    });

    expect(card.config.wide_screen_mode).toBe(true);
    expect(JSON.stringify(card)).toContain('打开 Base');
  });
});

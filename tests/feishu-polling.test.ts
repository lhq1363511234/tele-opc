import { describe, expect, it } from 'vitest';
import { parseFeishuCreateTime, toGatewayEvent } from '../src/feishu/polling.js';
import { completionPauseForAgentResult } from '../src/work/taskCompletion.js';

describe('Feishu polling fallback', () => {
  it('normalizes a polled user message into the gateway event contract', () => {
    const event = toGatewayEvent({
      chatId: 'oc_owner',
      content: '状态测试',
      createTime: '1785160000000',
      messageId: 'om_001',
      messageType: 'text',
      senderId: 'ou_owner',
      senderType: 'user'
    });
    expect(event).toMatchObject({
      chat_id: 'oc_owner',
      message_id: 'om_001',
      sender_id: 'ou_owner',
      sender_type: 'user',
      content: '状态测试'
    });
    expect(Number(event.timestamp)).toBe(1785160000000);
  });

  it('parses second and millisecond timestamps', () => {
    expect(parseFeishuCreateTime('1785160000')).toBe(1785160000000);
    expect(parseFeishuCreateTime('1785160000000')).toBe(1785160000000);
  });
});

describe('Agent completion gate', () => {
  it('sends an empty Agent result to review instead of marking it done', () => {
    expect(completionPauseForAgentResult({
      content: '',
      body: '',
      toolCalls: [{ name: 'write_file', status: 'done' }]
    })).toMatchObject({ status: 'review' });
  });

  it('keeps blocked external actions waiting for approval', () => {
    const paused = completionPauseForAgentResult({
      content: '',
      body: '',
      toolCalls: [{ name: 'send_email', status: 'blocked', output: { approvalId: 'apv_1' } }]
    });
    expect(paused?.status).toBe('waiting_approval');
    expect(paused?.text).toContain('apv_1');
  });
});

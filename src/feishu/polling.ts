import type { FeishuListedMessage, FeishuMessageEvent } from './types.js';

export function toGatewayEvent(message: FeishuListedMessage): FeishuMessageEvent {
  return {
    chat_id: message.chatId,
    chat_type: 'p2p',
    content: message.content,
    message_id: message.messageId,
    message_type: message.messageType,
    reply_to: message.replyTo,
    sender_id: message.senderId,
    sender_type: message.senderType,
    timestamp: String(parseFeishuCreateTime(message.createTime))
  };
}

export function parseFeishuCreateTime(value: string) {
  if (/^\d{10,13}$/.test(value)) {
    const numeric = Number(value);
    return value.length === 10 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

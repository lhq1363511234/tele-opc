export interface FeishuMessageEvent {
  chat_id: string;
  chat_type: 'p2p' | 'group' | string;
  content: string;
  message_id: string;
  message_type: string;
  reply_to?: string;
  sender_id: string;
  sender_type: string;
  timestamp?: string;
}

export interface FeishuSendResult {
  messageId: string;
  chatId?: string;
  createTime?: string;
}

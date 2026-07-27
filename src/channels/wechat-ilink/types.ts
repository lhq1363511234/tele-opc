export interface WechatAccountRecord {
  id: string;
  owner_user_id: string | null;
  bot_id: string;
  scanner_user_id: string | null;
  token_ciphertext: string;
  base_url: string;
  status: string;
  last_message_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WechatLoginSessionRecord {
  id: string;
  qrcode_ciphertext: string;
  qrcode_url: string;
  base_url: string;
  status: string;
  expires_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WechatMessage {
  message_id?: number | string;
  client_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  context_token?: string;
  item_list?: Array<{
    type?: number;
    text_item?: { text?: string };
    voice_item?: { text?: string };
  }>;
}

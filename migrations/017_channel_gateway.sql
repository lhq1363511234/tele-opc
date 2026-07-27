CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  external_chat_id TEXT NOT NULL,
  external_user_id TEXT,
  direction TEXT NOT NULL,
  text TEXT,
  internal_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation
  ON channel_messages(channel, external_chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_notifications (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  external_message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel, recipient_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_notifications_entity
  ON channel_notifications(entity_type, entity_id, created_at DESC);

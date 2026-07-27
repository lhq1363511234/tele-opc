CREATE TABLE IF NOT EXISTS bridge_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'windows',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bridge_outbox (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  source_message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  conversation_name TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  lease_token TEXT,
  leased_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS idx_bridge_outbox_claim ON bridge_outbox(device_id,status,created_at);

CREATE TABLE IF NOT EXISTS wechat_accounts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  bot_id TEXT NOT NULL UNIQUE,
  scanner_user_id TEXT,
  token_ciphertext TEXT NOT NULL,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  last_message_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wechat_login_sessions (
  id TEXT PRIMARY KEY,
  qrcode_ciphertext TEXT NOT NULL,
  qrcode_url TEXT NOT NULL,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wechat_sync_cursors (
  account_id TEXT PRIMARY KEY REFERENCES wechat_accounts(id) ON DELETE CASCADE,
  get_updates_buf TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wechat_context_tokens (
  account_id TEXT NOT NULL REFERENCES wechat_accounts(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  source_message_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, peer_id)
);

CREATE INDEX IF NOT EXISTS idx_wechat_accounts_status ON wechat_accounts(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wechat_login_sessions_expiry ON wechat_login_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_wechat_context_tokens_updated ON wechat_context_tokens(account_id, updated_at DESC);

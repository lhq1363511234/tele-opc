CREATE TABLE IF NOT EXISTS payment_qr_codes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'other',
  currency TEXT NOT NULL DEFAULT 'CNY',
  image_path TEXT NOT NULL,
  image_mime TEXT NOT NULL,
  image_size_bytes INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  short_code TEXT NOT NULL UNIQUE,
  qr_code_id TEXT REFERENCES payment_qr_codes(id) ON DELETE SET NULL,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  customer_name TEXT,
  customer_contact TEXT,
  amount NUMERIC(14, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  claimed_paid_at TIMESTAMPTZ,
  confirmed_paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  payer_name TEXT,
  payer_contact TEXT,
  payer_note TEXT,
  confirmation_note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_qr_codes_status_default ON payment_qr_codes(status, is_default);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status_created ON payment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_short_code ON payment_requests(short_code);
CREATE INDEX IF NOT EXISTS idx_payment_requests_qr_code_id ON payment_requests(qr_code_id);

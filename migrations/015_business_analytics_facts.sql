CREATE TABLE IF NOT EXISTS business_analytics_facts (
  id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  grain TEXT NOT NULL DEFAULT 'event',
  scope TEXT NOT NULL,
  metric_code TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC,
  score NUMERIC,
  channel TEXT,
  agent TEXT,
  stage TEXT,
  segment TEXT,
  customer TEXT,
  status TEXT,
  note TEXT,
  source_object_type TEXT,
  source_object_id TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_analytics_facts_time ON business_analytics_facts(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_analytics_facts_metric ON business_analytics_facts(metric_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_analytics_facts_scope ON business_analytics_facts(scope, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_analytics_facts_source ON business_analytics_facts(source_object_type, source_object_id);

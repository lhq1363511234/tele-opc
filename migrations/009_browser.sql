CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'manual',
  storage_path TEXT,
  allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS browser_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES browser_sessions(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  risk_level TEXT NOT NULL DEFAULT 'low',
  source TEXT NOT NULL DEFAULT 'telegram',
  result_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS browser_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES browser_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS browser_screenshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES browser_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES browser_steps(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  artifact_path TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS browser_extractions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES browser_runs(id) ON DELETE CASCADE,
  extraction_type TEXT NOT NULL DEFAULT 'summary',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'planned',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS browser_blocked_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES browser_runs(id) ON DELETE CASCADE,
  approval_id TEXT REFERENCES approvals(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'blocked',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_browser_runs_status ON browser_runs(status);
CREATE INDEX IF NOT EXISTS idx_browser_runs_target_domain ON browser_runs(target_domain);
CREATE INDEX IF NOT EXISTS idx_browser_steps_run_id ON browser_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_browser_blocked_actions_status ON browser_blocked_actions(status);

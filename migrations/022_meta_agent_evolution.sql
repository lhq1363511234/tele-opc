CREATE TABLE IF NOT EXISTS meta_agent_blueprints (
  id TEXT PRIMARY KEY,
  requirement TEXT NOT NULL,
  system_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  blueprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_agent_components (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES meta_agent_blueprints(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT,
  version TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  score NUMERIC(6, 3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'discovered',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blueprint_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS meta_agent_runs (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES meta_agent_blueprints(id) ON DELETE CASCADE,
  task_input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  selected_component_id TEXT REFERENCES meta_agent_components(id) ON DELETE SET NULL,
  final_output TEXT,
  audit_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_agent_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES meta_agent_runs(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  component_id TEXT REFERENCES meta_agent_components(id) ON DELETE SET NULL,
  producer_role TEXT NOT NULL,
  auditor_role TEXT NOT NULL,
  output TEXT NOT NULL,
  audit_status TEXT NOT NULL,
  audit_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  feedback TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_meta_agent_blueprints_created_at ON meta_agent_blueprints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_agent_components_blueprint_score ON meta_agent_components(blueprint_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_meta_agent_components_status ON meta_agent_components(status);
CREATE INDEX IF NOT EXISTS idx_meta_agent_runs_blueprint ON meta_agent_runs(blueprint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_agent_runs_status ON meta_agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_meta_agent_attempts_run ON meta_agent_attempts(run_id, attempt_no);

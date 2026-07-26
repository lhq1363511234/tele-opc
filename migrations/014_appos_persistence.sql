CREATE TABLE IF NOT EXISTS appos_business_contracts (
  id TEXT PRIMARY KEY,
  source_intent_packet_id TEXT NOT NULL,
  source_utterance_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  domain TEXT NOT NULL,
  success_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'low',
  approval_required BOOLEAN NOT NULL DEFAULT false,
  approval_reason TEXT,
  constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_policy TEXT NOT NULL DEFAULT 'candidate_only',
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appos_workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  business_contract_id TEXT REFERENCES appos_business_contracts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_output JSONB,
  normalized_output JSONB,
  external_execution_id TEXT,
  trace_id TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appos_application_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'tele-opc',
  event_type TEXT NOT NULL,
  local_object_type TEXT NOT NULL,
  local_object_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appos_failure_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  symptom TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  severity TEXT NOT NULL DEFAULT 'medium',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appos_contracts_domain ON appos_business_contracts(domain);
CREATE INDEX IF NOT EXISTS idx_appos_contracts_created_at ON appos_business_contracts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appos_runs_contract_id ON appos_workflow_runs(business_contract_id);
CREATE INDEX IF NOT EXISTS idx_appos_runs_status ON appos_workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_appos_events_object ON appos_application_events(local_object_type, local_object_id);
CREATE INDEX IF NOT EXISTS idx_appos_failures_object ON appos_failure_events(object_type, object_id);

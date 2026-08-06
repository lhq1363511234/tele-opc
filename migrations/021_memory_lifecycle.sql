CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  external_id TEXT,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  content TEXT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_sources_external
  ON knowledge_sources(source_type, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created_at
  ON knowledge_sources(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_artifact
  ON knowledge_sources(artifact_id)
  WHERE artifact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  why TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sensitivity TEXT NOT NULL DEFAULT 'private',
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  conflict_with_memory_id TEXT REFERENCES a_self_memory_items(id) ON DELETE SET NULL,
  resolved_memory_id TEXT REFERENCES a_self_memory_items(id) ON DELETE SET NULL,
  review_action TEXT,
  resolution_note TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_status
  ON memory_candidates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_candidates_source
  ON memory_candidates(source_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_memory_candidates_conflict
  ON memory_candidates(conflict_with_memory_id)
  WHERE conflict_with_memory_id IS NOT NULL;

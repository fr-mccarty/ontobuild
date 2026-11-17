-- Lint / quality / normalization tables (lint-quality agent).

CREATE TABLE IF NOT EXISTS lint_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | running | completed | failed
  branch TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  issues_found INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS ix_lint_runs_project ON lint_runs(project_id, started_at);

CREATE TABLE IF NOT EXISTS lint_issues (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES lint_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,                 -- error | warning | info
  rule_id TEXT NOT NULL,
  message TEXT NOT NULL,
  subject_iri TEXT,
  subject_type TEXT,                        -- class | property | individual | other
  details TEXT,                             -- JSON
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_lint_issues_run ON lint_issues(run_id, issue_type, rule_id);
CREATE INDEX IF NOT EXISTS ix_lint_issues_subject ON lint_issues(project_id, subject_iri);

CREATE TABLE IF NOT EXISTS project_lint_configs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  lint_level INTEGER CHECK (lint_level IS NULL OR lint_level BETWEEN 1 AND 5),
  enabled_rules TEXT,                       -- comma-separated; '' = explicitly none; NULL = unset
  updated_at TEXT NOT NULL
);

-- Latest consistency / duplicates result per (project, branch); replaces the Redis cache.
CREATE TABLE IF NOT EXISTS quality_results (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- consistency | duplicates
  result TEXT NOT NULL,                     -- JSON
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, branch, kind)
);

CREATE TABLE IF NOT EXISTS normalization_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  triggered_by TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual',   -- import | manual | automatic
  report_json TEXT NOT NULL,
  original_format TEXT NOT NULL,
  original_size_bytes INTEGER NOT NULL,
  normalized_size_bytes INTEGER NOT NULL,
  triple_count INTEGER NOT NULL,
  prefixes_removed_count INTEGER NOT NULL DEFAULT 0,
  prefixes_added_count INTEGER NOT NULL DEFAULT 0,
  format_converted INTEGER NOT NULL DEFAULT 0,
  is_dry_run INTEGER NOT NULL DEFAULT 0,
  commit_hash TEXT,
  -- The ontology file (repository-relative path) the run normalized. Added later: databases from
  -- before get it from ADDED_COLUMNS in server/db.ts, and their old rows have NULL here.
  ontology_path TEXT
);
CREATE INDEX IF NOT EXISTS ix_normalization_runs_project ON normalization_runs(project_id, created_at);

-- Cached "does the ontology need normalization?" check, keyed by the commit it was made at.
CREATE TABLE IF NOT EXISTS normalization_checks (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  commit_hash TEXT NOT NULL,
  needs_normalization INTEGER NOT NULL,
  report TEXT,                              -- JSON NormalizationReport (when changes would occur)
  checked_at TEXT NOT NULL
);

-- Core tables (foundation). Other domains add their own server/schema/<domain>.sql files.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  -- logical storage path, e.g. "projects/<id>/ontology.ttl" (null = no ontology file)
  source_file_path TEXT,
  -- path of the ontology file inside the git repo (default "ontology.ttl")
  git_ontology_path TEXT,
  ontology_iri TEXT,
  label_preferences TEXT,          -- JSON array of strings
  normalization_report TEXT,       -- JSON object
  pr_approval_required INTEGER NOT NULL DEFAULT 0,
  preferred_branch TEXT,           -- local user's preferred branch
  folder TEXT                      -- project folder name under data/projects (see server/workspace.ts)
);

CREATE TABLE IF NOT EXISTS branch_metadata (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  created_by_id TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, branch_name)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT,
  status TEXT NOT NULL,            -- pending | running | completed | failed
  progress REAL,
  message TEXT,
  result TEXT,                     -- JSON
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_jobs_project_kind ON jobs(project_id, kind, created_at);

CREATE TABLE IF NOT EXISTS rule_validations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, branch)
);

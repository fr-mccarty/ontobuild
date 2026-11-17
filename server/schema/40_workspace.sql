-- Per-project workspace settings: how to start the project's dev server.

CREATE TABLE IF NOT EXISTS project_workspace_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  dev_command TEXT,                          -- shell command, run with $SHELL -lc
  dev_cwd TEXT,                              -- project-relative directory
  dev_url TEXT,                              -- URL to open, overrides the detected one
  updated_at TEXT
);

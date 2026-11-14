-- Entity change events for analytics (PR/analytics agent).

CREATE TABLE IF NOT EXISTS entity_change_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  entity_iri TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  event_type TEXT NOT NULL,                 -- create | update | delete | rename | reparent | deprecate
  user_id TEXT NOT NULL,
  user_name TEXT,
  commit_hash TEXT,
  changed_fields TEXT,                      -- JSON array
  old_values TEXT,                          -- JSON object
  new_values TEXT,                          -- JSON object
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_change_events_project_entity ON entity_change_events(project_id, entity_iri);
CREATE INDEX IF NOT EXISTS ix_change_events_project_time ON entity_change_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS ix_change_events_project_branch_time ON entity_change_events(project_id, branch, created_at);

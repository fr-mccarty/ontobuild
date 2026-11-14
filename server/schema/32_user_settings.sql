-- Local user's settings (PR/analytics agent). Single row per user id.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}',      -- JSON object
  created_at TEXT NOT NULL,
  updated_at TEXT
);

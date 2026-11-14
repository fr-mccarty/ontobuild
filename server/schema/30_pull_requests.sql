-- Pull requests, reviews and comments (PR/analytics agent).

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'open',      -- open | merged | closed
  author_id TEXT NOT NULL,
  author_name TEXT,
  author_email TEXT,
  merged_by TEXT,
  merged_at TEXT,
  merge_commit_hash TEXT,
  base_commit_hash TEXT,
  head_commit_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (project_id, pr_number)
);
CREATE INDEX IF NOT EXISTS ix_pull_requests_project_status ON pull_requests(project_id, status);

CREATE TABLE IF NOT EXISTS pull_request_reviews (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL,
  reviewer_name TEXT,
  reviewer_email TEXT,
  status TEXT NOT NULL,                     -- approved | changes_requested | commented
  body TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pr_reviews_pr ON pull_request_reviews(pull_request_id);

CREATE TABLE IF NOT EXISTS pull_request_comments (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT,
  author_email TEXT,
  body TEXT NOT NULL,
  parent_id TEXT REFERENCES pull_request_comments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_pr_comments_pr ON pull_request_comments(pull_request_id);

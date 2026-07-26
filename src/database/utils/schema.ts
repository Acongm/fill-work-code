export const SCHEMA_VERSION = 1;

export const SCHEMA_VERSION_1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_path TEXT PRIMARY KEY,
  source_size INTEGER NOT NULL,
  source_mtime_ms INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  origin_url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_clones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_root TEXT NOT NULL UNIQUE,
  clone_label TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_scanned_at TEXT,
  last_commit_at TEXT
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  range_start TEXT,
  range_end TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS commits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  clone_id TEXT NOT NULL REFERENCES project_clones(id),
  sha TEXT NOT NULL,
  subject TEXT NOT NULL,
  author TEXT,
  committed_at TEXT NOT NULL,
  collection_run_id TEXT REFERENCES collection_runs(id),
  UNIQUE(clone_id, sha)
);

CREATE TABLE IF NOT EXISTS gitlog_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  clone_id TEXT REFERENCES project_clones(id),
  content TEXT NOT NULL,
  collection_run_id TEXT REFERENCES collection_runs(id)
);

CREATE TABLE IF NOT EXISTS gitlog_entry_commits (
  gitlog_entry_id TEXT NOT NULL REFERENCES gitlog_entries(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  PRIMARY KEY (gitlog_entry_id, commit_id)
);

CREATE TABLE IF NOT EXISTS daily_items (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('completed', 'ailog', 'todo', 'blocker', 'note')
  ),
  content TEXT NOT NULL,
  assignment TEXT NOT NULL CHECK (
    assignment IN ('project', 'unassigned')
  ),
  project_id TEXT REFERENCES projects(id),
  source TEXT NOT NULL CHECK (
    source IN ('manual', 'ai', 'migration')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (assignment = 'project' AND project_id IS NOT NULL) OR
    (assignment = 'unassigned' AND project_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (
    provider IN ('codex', 'cursor', 'qoder')
  ),
  external_session_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  clone_id TEXT REFERENCES project_clones(id),
  cwd TEXT,
  title TEXT,
  started_at TEXT,
  updated_at TEXT,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  UNIQUE(provider, external_session_id)
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  external_message_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT,
  sequence INTEGER NOT NULL,
  UNIQUE(session_id, sequence)
);

CREATE TABLE IF NOT EXISTS daily_ai_evidence (
  daily_item_id TEXT NOT NULL REFERENCES daily_items(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES ai_messages(id) ON DELETE CASCADE,
  PRIMARY KEY (daily_item_id, session_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_project_clones_project
  ON project_clones(project_id);
CREATE INDEX IF NOT EXISTS idx_commits_project_date
  ON commits(project_id, committed_at);
CREATE INDEX IF NOT EXISTS idx_gitlog_project_date
  ON gitlog_entries(project_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_items_date
  ON daily_items(date, sort_order);
CREATE INDEX IF NOT EXISTS idx_daily_items_project_date
  ON daily_items(project_id, date);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_project
  ON ai_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session_sequence
  ON ai_messages(session_id, sequence);
`;

CREATE TABLE IF NOT EXISTS issues (
  key          TEXT PRIMARY KEY,
  summary      TEXT NOT NULL,
  issue_type   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  current_status TEXT NOT NULL,
  assignee     TEXT,
  priority     TEXT,
  current_sprint_id INTEGER
);

CREATE TABLE IF NOT EXISTS sprints (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  state       TEXT NOT NULL,
  start_date  TEXT,
  end_date    TEXT,
  board_id    INTEGER NOT NULL
);

-- Chaque changement de statut. Source de vérité pour toutes les métriques.
CREATE TABLE IF NOT EXISTS transitions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key      TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  transitioned_at TEXT NOT NULL,
  FOREIGN KEY (issue_key) REFERENCES issues(key)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  synced_at   TEXT NOT NULL,
  issues_count INTEGER NOT NULL,
  project_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transitions_issue_key ON transitions(issue_key);
CREATE INDEX IF NOT EXISTS idx_transitions_to_status ON transitions(to_status);
CREATE INDEX IF NOT EXISTS idx_transitions_at ON transitions(transitioned_at);

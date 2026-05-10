CREATE TABLE IF NOT EXISTS issues (
  key          TEXT PRIMARY KEY,
  summary      TEXT NOT NULL,
  issue_type   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  current_status TEXT NOT NULL,
  assignee     TEXT,
  priority     TEXT,
  current_sprint_id INTEGER,
  original_estimate_seconds INTEGER,
  story_points              REAL,
  size_label                TEXT
);

CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
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

-- Mapping statut → catégorie Atlassian standard (new / indeterminate / done).
-- Plus fiable que les listes manuelles de doneStatuses dans config.yaml :
-- workflow renommé garde les anciens noms dans les transitions, mais la
-- catégorie reste cohérente.
CREATE TABLE IF NOT EXISTS statuses (
  name          TEXT PRIMARY KEY,
  category_key  TEXT NOT NULL,
  category_name TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS issue_field_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key   TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  changed_at  TEXT NOT NULL,
  FOREIGN KEY (issue_key) REFERENCES issues(key)
);

CREATE INDEX IF NOT EXISTS idx_field_changes_issue_key ON issue_field_changes(issue_key);
CREATE INDEX IF NOT EXISTS idx_field_changes_field ON issue_field_changes(field_name);
CREATE INDEX IF NOT EXISTS idx_field_changes_at ON issue_field_changes(changed_at);

CREATE TABLE IF NOT EXISTS issue_sprints (
  issue_key  TEXT NOT NULL,
  sprint_id  INTEGER NOT NULL,
  PRIMARY KEY (issue_key, sprint_id),
  FOREIGN KEY (issue_key) REFERENCES issues(key),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id)
);

CREATE INDEX IF NOT EXISTS idx_issue_sprints_issue_key ON issue_sprints(issue_key);
CREATE INDEX IF NOT EXISTS idx_issue_sprints_sprint ON issue_sprints(sprint_id);

-- Snapshots historiques pour visualisation de tendances. Long format:
-- une ligne par (date, métrique, bucket, statistique).
CREATE TABLE IF NOT EXISTS metric_snapshots (
  snapshot_date  TEXT NOT NULL,
  metric_name    TEXT NOT NULL,
  bucket         TEXT NOT NULL DEFAULT '',
  stat           TEXT NOT NULL,
  value          REAL NOT NULL,
  PRIMARY KEY (snapshot_date, metric_name, bucket, stat)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON metric_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_metric ON metric_snapshots(metric_name);

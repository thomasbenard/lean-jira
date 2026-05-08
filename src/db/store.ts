import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { type FieldChange, type StoredIssue, type StoredSprint, type StoredStatus, type Transition } from "../jira/types";
import { now } from "../clock";

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);

  return db;
}

function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "current_sprint_id")) {
    db.exec("ALTER TABLE issues ADD COLUMN current_sprint_id INTEGER");
  }
  if (!cols.some((c) => c.name === "original_estimate_seconds")) {
    db.exec("ALTER TABLE issues ADD COLUMN original_estimate_seconds INTEGER");
  }
}

export function upsertIssues(db: Database.Database, issues: StoredIssue[]): void {
  const stmt = db.prepare(`
    INSERT INTO issues (key, summary, issue_type, created_at, resolved_at, current_status, assignee, priority, current_sprint_id, original_estimate_seconds)
    VALUES (@key, @summary, @issueType, @createdAt, @resolvedAt, @currentStatus, @assignee, @priority, @currentSprintId, @originalEstimateSeconds)
    ON CONFLICT(key) DO UPDATE SET
      summary        = excluded.summary,
      issue_type     = excluded.issue_type,
      resolved_at    = excluded.resolved_at,
      current_status = excluded.current_status,
      assignee       = excluded.assignee,
      priority       = excluded.priority,
      current_sprint_id = excluded.current_sprint_id,
      original_estimate_seconds = excluded.original_estimate_seconds
  `);

  const insertMany = db.transaction((rows: StoredIssue[]) => {
    for (const row of rows) {stmt.run(row);}
  });

  insertMany(issues);
}

export function upsertSprints(db: Database.Database, sprints: StoredSprint[]): void {
  const stmt = db.prepare(`
    INSERT INTO sprints (id, name, state, start_date, end_date, board_id)
    VALUES (@id, @name, @state, @startDate, @endDate, @boardId)
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      state      = excluded.state,
      start_date = excluded.start_date,
      end_date   = excluded.end_date,
      board_id   = excluded.board_id
  `);
  const insertMany = db.transaction((rows: StoredSprint[]) => {
    for (const row of rows) {stmt.run(row);}
  });
  insertMany(sprints);
}

export function replaceTransitions(db: Database.Database, issueKey: string, transitions: Transition[]): void {
  replaceAllTransitions(db, [{ key: issueKey, transitions }]);
}

export function replaceAllTransitions(
  db: Database.Database,
  allTransitions: { key: string; transitions: Transition[] }[],
): void {
  const del = db.prepare("DELETE FROM transitions WHERE issue_key = ?");
  const ins = db.prepare(`
    INSERT INTO transitions (issue_key, from_status, to_status, transitioned_at)
    VALUES (@issueKey, @fromStatus, @toStatus, @transitionedAt)
  `);

  db.transaction(() => {
    for (const { key, transitions } of allTransitions) {
      del.run(key);
      for (const t of transitions) {ins.run(t);}
    }
  })();
}

export function replaceAllFieldChanges(
  db: Database.Database,
  allChanges: { key: string; changes: FieldChange[] }[],
): void {
  const del = db.prepare("DELETE FROM issue_field_changes WHERE issue_key = ?");
  const ins = db.prepare(`
    INSERT INTO issue_field_changes (issue_key, field_name, from_value, to_value, changed_at)
    VALUES (@issueKey, @fieldName, @fromValue, @toValue, @changedAt)
  `);

  db.transaction(() => {
    for (const { key, changes } of allChanges) {
      del.run(key);
      for (const c of changes) {ins.run(c);}
    }
  })();
}

export function replaceAllIssueSprints(
  db: Database.Database,
  allItems: { key: string; sprintIds: number[] }[],
): void {
  const del = db.prepare("DELETE FROM issue_sprints WHERE issue_key = ?");
  const ins = db.prepare("INSERT OR IGNORE INTO issue_sprints (issue_key, sprint_id) VALUES (?, ?)");

  db.transaction(() => {
    for (const { key, sprintIds } of allItems) {
      del.run(key);
      for (const id of sprintIds) { ins.run(key, id); }
    }
  })();
}

export function upsertStatuses(db: Database.Database, statuses: StoredStatus[]): void {
  const stmt = db.prepare(`
    INSERT INTO statuses (name, category_key, category_name)
    VALUES (@name, @categoryKey, @categoryName)
    ON CONFLICT(name) DO UPDATE SET
      category_key  = excluded.category_key,
      category_name = excluded.category_name
  `);
  const insertMany = db.transaction((rows: StoredStatus[]) => {
    for (const row of rows) {stmt.run(row);}
  });
  insertMany(statuses);
}

// Renvoie l'ensemble des noms de statuts dont statusCategory.key = 'done'.
// Source de vérité préférée à doneStatuses du config (immune aux renommages).
export function getDoneStatusNames(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT name FROM statuses WHERE category_key = 'done'`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

export function getAllStatuses(db: Database.Database): { name: string; categoryKey: string }[] {
  return db.prepare("SELECT name, category_key AS categoryKey FROM statuses ORDER BY name").all() as { name: string; categoryKey: string }[];
}

export function getLastSyncDate(db: Database.Database, projectKey: string): string | null {
  const row = db.prepare(
    "SELECT MAX(synced_at) as last FROM sync_log WHERE project_key = ?"
  ).get(projectKey) as { last: string | null };
  return row.last;
}

export function getDistinctTransitionStatuses(db: Database.Database, since?: string): string[] {
  const rows = since
    ? db.prepare("SELECT DISTINCT to_status FROM transitions WHERE transitioned_at >= ?").all(since)
    : db.prepare("SELECT DISTINCT to_status FROM transitions").all();
  return (rows as { to_status: string }[]).map((r) => r.to_status);
}

export function logSync(db: Database.Database, projectKey: string, issuesCount: number): void {
  db.prepare(
    "INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)"
  ).run(now().toISOString(), issuesCount, projectKey);
}

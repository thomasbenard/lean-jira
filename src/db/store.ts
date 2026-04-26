import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { StoredIssue, StoredSprint, Transition } from "../jira/types";

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
  const cols = db.prepare("PRAGMA table_info(issues)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "current_sprint_id")) {
    db.exec("ALTER TABLE issues ADD COLUMN current_sprint_id INTEGER");
  }
}

export function upsertIssues(db: Database.Database, issues: StoredIssue[]): void {
  const stmt = db.prepare(`
    INSERT INTO issues (key, summary, issue_type, created_at, resolved_at, current_status, assignee, priority, current_sprint_id)
    VALUES (@key, @summary, @issueType, @createdAt, @resolvedAt, @currentStatus, @assignee, @priority, @currentSprintId)
    ON CONFLICT(key) DO UPDATE SET
      summary        = excluded.summary,
      issue_type     = excluded.issue_type,
      resolved_at    = excluded.resolved_at,
      current_status = excluded.current_status,
      assignee       = excluded.assignee,
      priority       = excluded.priority,
      current_sprint_id = excluded.current_sprint_id
  `);

  const insertMany = db.transaction((rows: StoredIssue[]) => {
    for (const row of rows) stmt.run(row);
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
    for (const row of rows) stmt.run(row);
  });
  insertMany(sprints);
}

export function replaceTransitions(db: Database.Database, issueKey: string, transitions: Transition[]): void {
  const del = db.prepare("DELETE FROM transitions WHERE issue_key = ?");
  const ins = db.prepare(`
    INSERT INTO transitions (issue_key, from_status, to_status, transitioned_at)
    VALUES (@issueKey, @fromStatus, @toStatus, @transitionedAt)
  `);

  const replace = db.transaction(() => {
    del.run(issueKey);
    for (const t of transitions) ins.run(t);
  });

  replace();
}

export function logSync(db: Database.Database, projectKey: string, issuesCount: number): void {
  db.prepare(
    "INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)"
  ).run(new Date().toISOString(), issuesCount, projectKey);
}

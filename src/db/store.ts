import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { StoredIssue, Transition } from "../jira/types";

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);

  return db;
}

export function upsertIssues(db: Database.Database, issues: StoredIssue[]): void {
  const stmt = db.prepare(`
    INSERT INTO issues (key, summary, issue_type, created_at, resolved_at, current_status, assignee, priority)
    VALUES (@key, @summary, @issueType, @createdAt, @resolvedAt, @currentStatus, @assignee, @priority)
    ON CONFLICT(key) DO UPDATE SET
      summary        = excluded.summary,
      issue_type     = excluded.issue_type,
      resolved_at    = excluded.resolved_at,
      current_status = excluded.current_status,
      assignee       = excluded.assignee,
      priority       = excluded.priority
  `);

  const insertMany = db.transaction((rows: StoredIssue[]) => {
    for (const row of rows) stmt.run(row);
  });

  insertMany(issues);
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

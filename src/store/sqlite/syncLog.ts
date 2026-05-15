import type Database from "better-sqlite3";
import type { SyncLogRecord } from "../types";

interface Row {
  synced_at: string;
  issues_count: number;
  project_key: string;
}

function toRecord(r: Row): SyncLogRecord {
  return {
    syncedAt: r.synced_at,
    issuesCount: r.issues_count,
    projectKey: r.project_key,
  };
}

export class SyncLogSqlite {
  constructor(private readonly db: Database.Database) {}

  lastByProject(projectKey: string): SyncLogRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM sync_log WHERE project_key = ? ORDER BY synced_at DESC LIMIT 1",
    ).get(projectKey) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  append(record: SyncLogRecord): void {
    this.db.prepare(
      "INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)",
    ).run(record.syncedAt, record.issuesCount, record.projectKey);
  }
}

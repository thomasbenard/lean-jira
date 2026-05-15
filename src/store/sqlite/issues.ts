import type Database from "better-sqlite3";
import type { IssueRecord } from "../types";

interface Row {
  key: string;
  summary: string;
  issue_type: string;
  created_at: string;
  resolved_at: string | null;
  current_status: string;
  assignee: string | null;
  priority: string | null;
  current_sprint_id: number | null;
  original_estimate_seconds: number | null;
  story_points: number | null;
  size_label: string | null;
}

function toRecord(r: Row): IssueRecord {
  return {
    key: r.key,
    summary: r.summary,
    issueType: r.issue_type,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    currentStatus: r.current_status,
    assignee: r.assignee,
    priority: r.priority,
    currentSprintId: r.current_sprint_id,
    originalEstimateSeconds: r.original_estimate_seconds,
    storyPoints: r.story_points,
    sizeLabel: r.size_label,
  };
}

export class IssuesSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): IssueRecord[] {
    const rows = this.db.prepare("SELECT * FROM issues ORDER BY key").all() as Row[];
    return rows.map(toRecord);
  }

  byKey(key: string): IssueRecord | null {
    const row = this.db.prepare("SELECT * FROM issues WHERE key = ?").get(key) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  byKeys(keys: string[]): IssueRecord[] {
    // pourquoi : court-circuit avant prepare() — `IN ()` est invalide en SQL
    // et un appel sans clé n'a aucun row à retourner.
    if (keys.length === 0) {return [];}
    const placeholders = keys.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM issues WHERE key IN (${placeholders})`)
      .all(...keys) as Row[];
    return rows.map(toRecord);
  }

  upsertMany(records: IssueRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO issues (key, summary, issue_type, created_at, resolved_at, current_status, assignee, priority, current_sprint_id, original_estimate_seconds, story_points, size_label)
      VALUES (@key, @summary, @issueType, @createdAt, @resolvedAt, @currentStatus, @assignee, @priority, @currentSprintId, @originalEstimateSeconds, @storyPoints, @sizeLabel)
      ON CONFLICT(key) DO UPDATE SET
        summary        = excluded.summary,
        issue_type     = excluded.issue_type,
        resolved_at    = excluded.resolved_at,
        current_status = excluded.current_status,
        assignee       = excluded.assignee,
        priority       = excluded.priority,
        current_sprint_id = excluded.current_sprint_id,
        original_estimate_seconds = excluded.original_estimate_seconds,
        story_points   = excluded.story_points,
        size_label     = excluded.size_label
    `);
    const tx = this.db.transaction((rows: IssueRecord[]) => {
      for (const r of rows) {
        stmt.run(r);
      }
    });
    tx(records);
  }
}

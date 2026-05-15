import type Database from "better-sqlite3";
import type { TransitionRecord } from "../types";

interface Row {
  id: number;
  issue_key: string;
  from_status: string | null;
  to_status: string;
  transitioned_at: string;
}

function toRecord(r: Row): TransitionRecord {
  return {
    id: r.id,
    issueKey: r.issue_key,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    transitionedAt: r.transitioned_at,
  };
}

export class TransitionsSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): TransitionRecord[] {
    const rows = this.db.prepare("SELECT * FROM transitions ORDER BY id").all() as Row[];
    return rows.map(toRecord);
  }

  byIssue(key: string): TransitionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM transitions WHERE issue_key = ? ORDER BY transitioned_at ASC, id ASC",
    ).all(key) as Row[];
    return rows.map(toRecord);
  }

  replaceForIssue(key: string, records: Omit<TransitionRecord, "id">[]): void {
    this.replaceForIssues([{ key, rows: records }]);
  }

  replaceForIssues(items: { key: string; rows: Omit<TransitionRecord, "id">[] }[]): void {
    const del = this.db.prepare("DELETE FROM transitions WHERE issue_key = ?");
    const ins = this.db.prepare(`
      INSERT INTO transitions (issue_key, from_status, to_status, transitioned_at)
      VALUES (@issueKey, @fromStatus, @toStatus, @transitionedAt)
    `);
    const tx = this.db.transaction((batches: { key: string; rows: Omit<TransitionRecord, "id">[] }[]) => {
      for (const b of batches) {
        del.run(b.key);
        for (const r of b.rows) {
          ins.run(r);
        }
      }
    });
    tx(items);
  }
}

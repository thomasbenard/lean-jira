import type Database from "better-sqlite3";
import type { IssueFieldChangeRecord } from "../types";

interface Row {
  issue_key: string;
  field_name: string;
  from_value: string | null;
  to_value: string | null;
  changed_at: string;
}

function toRecord(r: Row): IssueFieldChangeRecord {
  return {
    issueKey: r.issue_key,
    fieldName: r.field_name,
    fromValue: r.from_value,
    toValue: r.to_value,
    changedAt: r.changed_at,
  };
}

export class IssueFieldChangesSqlite {
  constructor(private readonly db: Database.Database) {}

  byIssueAndField(key: string, field: string): IssueFieldChangeRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM issue_field_changes WHERE issue_key = ? AND field_name = ? ORDER BY changed_at ASC",
    ).all(key, field) as Row[];
    return rows.map(toRecord);
  }

  replaceForIssues(items: { key: string; rows: IssueFieldChangeRecord[] }[]): void {
    const del = this.db.prepare("DELETE FROM issue_field_changes WHERE issue_key = ?");
    const ins = this.db.prepare(`
      INSERT INTO issue_field_changes (issue_key, field_name, from_value, to_value, changed_at)
      VALUES (@issueKey, @fieldName, @fromValue, @toValue, @changedAt)
    `);
    const tx = this.db.transaction((batches: { key: string; rows: IssueFieldChangeRecord[] }[]) => {
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

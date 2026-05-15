import type Database from "better-sqlite3";
import type { IssueSprintRecord } from "../types";

interface Row {
  issue_key: string;
  sprint_id: number;
}

function toRecord(r: Row): IssueSprintRecord {
  return { issueKey: r.issue_key, sprintId: r.sprint_id };
}

export class IssueSprintsSqlite {
  constructor(private readonly db: Database.Database) {}

  bySprint(sprintId: number): IssueSprintRecord[] {
    const rows = this.db.prepare("SELECT * FROM issue_sprints WHERE sprint_id = ?").all(sprintId) as Row[];
    return rows.map(toRecord);
  }

  byIssue(key: string): IssueSprintRecord[] {
    const rows = this.db.prepare("SELECT * FROM issue_sprints WHERE issue_key = ?").all(key) as Row[];
    return rows.map(toRecord);
  }

  replaceForIssues(items: { key: string; sprintIds: number[] }[]): void {
    const del = this.db.prepare("DELETE FROM issue_sprints WHERE issue_key = ?");
    const ins = this.db.prepare("INSERT OR IGNORE INTO issue_sprints (issue_key, sprint_id) VALUES (?, ?)");
    const tx = this.db.transaction((batches: { key: string; sprintIds: number[] }[]) => {
      for (const b of batches) {
        del.run(b.key);
        for (const id of b.sprintIds) {
          ins.run(b.key, id);
        }
      }
    });
    tx(items);
  }
}

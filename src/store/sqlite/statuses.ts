import type Database from "better-sqlite3";
import type { StatusRecord } from "../types";

interface Row {
  name: string;
  category_key: string;
  category_name: string;
}

function toRecord(r: Row): StatusRecord {
  return {
    name: r.name,
    categoryKey: r.category_key,
    categoryName: r.category_name,
  };
}

export class StatusesSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): StatusRecord[] {
    const rows = this.db.prepare("SELECT * FROM statuses ORDER BY name").all() as Row[];
    return rows.map(toRecord);
  }

  upsertMany(records: StatusRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO statuses (name, category_key, category_name)
      VALUES (@name, @categoryKey, @categoryName)
      ON CONFLICT(name) DO UPDATE SET
        category_key  = excluded.category_key,
        category_name = excluded.category_name
    `);
    const tx = this.db.transaction((rows: StatusRecord[]) => {
      for (const r of rows) {
        stmt.run(r);
      }
    });
    tx(records);
  }
}

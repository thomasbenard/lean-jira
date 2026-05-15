import type Database from "better-sqlite3";
import type { SprintRecord } from "../types";

interface Row {
  id: number;
  name: string;
  state: string;
  start_date: string | null;
  end_date: string | null;
  board_id: number;
}

function toRecord(r: Row): SprintRecord {
  return {
    id: r.id,
    name: r.name,
    state: r.state,
    startDate: r.start_date,
    endDate: r.end_date,
    boardId: r.board_id,
  };
}

export class SprintsSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): SprintRecord[] {
    const rows = this.db.prepare("SELECT * FROM sprints ORDER BY id").all() as Row[];
    return rows.map(toRecord);
  }

  byId(id: number): SprintRecord | null {
    const row = this.db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  upsertMany(records: SprintRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO sprints (id, name, state, start_date, end_date, board_id)
      VALUES (@id, @name, @state, @startDate, @endDate, @boardId)
      ON CONFLICT(id) DO UPDATE SET
        name       = excluded.name,
        state      = excluded.state,
        start_date = excluded.start_date,
        end_date   = excluded.end_date,
        board_id   = excluded.board_id
    `);
    const tx = this.db.transaction((rows: SprintRecord[]) => {
      for (const r of rows) {
        stmt.run(r);
      }
    });
    tx(records);
  }
}

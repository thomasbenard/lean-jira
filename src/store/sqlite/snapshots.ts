import type Database from "better-sqlite3";
import type { SnapshotRecord } from "../types";

interface Row {
  snapshot_date: string;
  metric_name: string;
  bucket: string;
  stat: string;
  value: number;
}

function toRecord(r: Row): SnapshotRecord {
  return {
    snapshotDate: r.snapshot_date,
    metricName: r.metric_name,
    bucket: r.bucket,
    stat: r.stat,
    value: r.value,
  };
}

export class SnapshotsSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): SnapshotRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM metric_snapshots ORDER BY snapshot_date, metric_name, bucket, stat")
      .all() as Row[];
    return rows.map(toRecord);
  }

  byDate(date: string): SnapshotRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM metric_snapshots WHERE snapshot_date = ? ORDER BY metric_name, bucket, stat")
      .all(date) as Row[];
    return rows.map(toRecord);
  }

  replaceAll(records: SnapshotRecord[]): void {
    const del = this.db.prepare("DELETE FROM metric_snapshots");
    const ins = this.db.prepare(`
      INSERT INTO metric_snapshots (snapshot_date, metric_name, bucket, stat, value)
      VALUES (@snapshotDate, @metricName, @bucket, @stat, @value)
    `);
    const tx = this.db.transaction((rows: SnapshotRecord[]) => {
      del.run();
      for (const r of rows) {
        ins.run(r);
      }
    });
    tx(records);
  }
}

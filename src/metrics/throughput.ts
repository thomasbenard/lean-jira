import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";

export interface ThroughputByWeek {
  week: string;
  count: number;
}

export interface ThroughputSummary {
  byWeek: ThroughputByWeek[];
  avgPerWeek: number;
}

export const throughputMetric: Metric<ThroughputSummary> = {
  name: "throughput",
  description: "Nombre d'issues terminées par semaine",

  compute(db: Database.Database, config: MetricConfig): ThroughputSummary {
    const placeholders = config.doneStatuses.map(() => "?").join(",");

    const rows = db.prepare(`
      SELECT
        strftime('%Y-W%W', transitioned_at) AS week,
        COUNT(DISTINCT issue_key) AS count
      FROM transitions
      WHERE to_status IN (${placeholders})
      GROUP BY week
      ORDER BY week ASC
    `).all(...config.doneStatuses) as ThroughputByWeek[];

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const avgPerWeek = rows.length > 0 ? total / rows.length : 0;

    return { byWeek: rows, avgPerWeek };
  },
};

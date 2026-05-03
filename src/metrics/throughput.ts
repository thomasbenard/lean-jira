import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildWindowFragment } from "./utils";

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
  description:
    "Issues livrées par semaine. Livraison = 1ère transition vers statut team-done (statusCategory='done' ∪ doneStatuses config).",

  compute(db: Database.Database, config: MetricConfig): ThroughputSummary {
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT
        strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week,
        COUNT(*) AS count
      FROM delivered d
      WHERE 1=1 ${cutoffSql} ${endSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...delivered.args, ...cutoffArgs, ...endArgs) as ThroughputByWeek[];

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const avgPerWeek = rows.length > 0 ? total / rows.length : 0;

    return { byWeek: rows, avgPerWeek };
  },
};

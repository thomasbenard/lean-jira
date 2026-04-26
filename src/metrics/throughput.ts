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
    const cutoffSql = config.cutoffDate ? "AND resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];

    // resolved_at vient du champ Jira `resolutiondate`, préservé à travers les migrations
    // workflow. Plus fiable que de filtrer les transitions (bulk closes les polluent).
    const rows = db.prepare(`
      SELECT
        strftime('%Y-W%W', substr(resolved_at, 1, 10)) AS week,
        COUNT(*) AS count
      FROM issues
      WHERE resolved_at IS NOT NULL ${cutoffSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...cutoffArgs) as ThroughputByWeek[];

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const avgPerWeek = rows.length > 0 ? total / rows.length : 0;

    return { byWeek: rows, avgPerWeek };
  },
};

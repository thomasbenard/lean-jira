import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";

export interface BugThroughputByWeek {
  week: string;
  count: number;
}

export interface BugThroughputSummary {
  byWeek: BugThroughputByWeek[];
  avgPerWeek: number;
}

export const bugThroughputMetric: Metric<BugThroughputSummary> = {
  name: "bug-throughput",
  description: "Bugs livrés par semaine. Mesure la charge incidents (vs débit features).",

  compute(db: Database.Database, config: MetricConfig): BugThroughputSummary {
    if (config.bugIssueTypes.length === 0) {
      return { byWeek: [], avgPerWeek: 0 };
    }

    const bugPh = config.bugIssueTypes.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND resolved_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    const rows = db.prepare(`
      SELECT
        strftime('%Y-W%W', substr(resolved_at, 1, 10)) AS week,
        COUNT(*) AS count
      FROM issues
      WHERE resolved_at IS NOT NULL
        AND issue_type IN (${bugPh})
        ${cutoffSql}
        ${endSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...config.bugIssueTypes, ...cutoffArgs, ...endArgs) as BugThroughputByWeek[];

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const avgPerWeek = rows.length > 0 ? total / rows.length : 0;

    return { byWeek: rows, avgPerWeek };
  },
};

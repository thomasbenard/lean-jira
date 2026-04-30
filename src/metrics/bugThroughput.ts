import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { buildDeliveredCte, buildWindowFragment, placeholders } from "./utils";
import { ThroughputByWeek, ThroughputSummary } from "./throughput";

export type { ThroughputByWeek as BugThroughputByWeek, ThroughputSummary as BugThroughputSummary };

export const bugThroughputMetric: Metric<ThroughputSummary> = {
  name: "bug-throughput",
  description: "Bugs livrés par semaine (1ère transition team-done). Mesure la charge incidents (vs débit features).",

  compute(db: Database.Database, config: MetricConfig): ThroughputSummary {
    if (config.bugIssueTypes.length === 0) {
      return { byWeek: [], avgPerWeek: 0 };
    }

    const bugPh = placeholders(config.bugIssueTypes);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT
        strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week,
        COUNT(*) AS count
      FROM delivered d
      JOIN issues i ON i.key = d.issue_key
      WHERE i.issue_type IN (${bugPh})
        ${cutoffSql}
        ${endSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...delivered.args, ...config.bugIssueTypes, ...cutoffArgs, ...endArgs) as ThroughputByWeek[];

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const avgPerWeek = rows.length > 0 ? total / rows.length : 0;

    return { byWeek: rows, avgPerWeek };
  },
};

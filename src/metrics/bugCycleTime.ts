import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildWindowFragment, type DurationStats, placeholders, statsFromDays, workingDaysBetween } from "./utils";

export interface BugCycleTimeResult extends DurationStats {
  unit: string;
}

export const bugCycleTimeMetric: Metric<BugCycleTimeResult> = {
  name: "bug-cycle-time",
  description:
    "Cycle-time des bugs (1er 'Développement en cours' -> 1er statut team-done). Mesure la réactivité aux incidents.",

  compute(db: Database.Database, config: MetricConfig): BugCycleTimeResult {
    if (config.bugIssueTypes.length === 0) {
      return { ...statsFromDays([]), unit: "j" };
    }

    const devStartPh = placeholders(config.devStartStatuses);
    const bugPh = placeholders(config.bugIssueTypes);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, d.done_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        AND i.issue_type IN (${bugPh})
        ${cutoffSql}
        ${endSql}
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...config.bugIssueTypes,
      ...cutoffArgs,
      ...endArgs,
    ) as { started_at: string; done_at: string }[];

    const days: number[] = [];
    for (const r of rows) {
      const d = workingDaysBetween(r.started_at, r.done_at);
      if (d >= 0) {days.push(d);}
    }

    return { ...statsFromDays(days, config.excludeOutliers !== false), unit: "j" };
  },
};

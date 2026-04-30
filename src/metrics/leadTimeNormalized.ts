import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { buildBugExclusionFragment, buildDeliveredCte, buildWindowFragment, DurationStats, placeholders, SECONDS_PER_DAY, statsFromDays, workingDaysBetween } from "./utils";

export interface LeadTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const leadTimeNormalizedMetric: Metric<LeadTimeNormalizedResult> = {
  name: "lead-time-normalized",
  description:
    "Lead-time total (backlog -> 1er statut team-done) divisé par l'estimation. Inclut attente. Cf. cycle-time-normalized pour dérive dev seul.",

  compute(db: Database.Database, config: MetricConfig): LeadTimeNormalizedResult {
    const todoPh = placeholders(config.todoStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { bugSql, bugArgs } = buildBugExclusionFragment(config.bugIssueTypes);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS todo_at, d.done_at, i.original_estimate_seconds
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${todoPh})
        AND i.original_estimate_seconds > 0
        ${bugSql}
        ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${devStartPh}))
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.todoStatuses,
      ...bugArgs,
      ...cutoffArgs,
      ...endArgs,
      ...config.devStartStatuses,
    ) as Array<{ todo_at: string; done_at: string; original_estimate_seconds: number }>;

    const ratios: number[] = [];
    for (const r of rows) {
      const leadDays = workingDaysBetween(r.todo_at, r.done_at);
      if (leadDays < 0) continue;
      const estimateDays = r.original_estimate_seconds / SECONDS_PER_DAY;
      ratios.push(leadDays / estimateDays);
    }

    return { ...statsFromDays(ratios, config.excludeOutliers !== false), unit: "ratio (lead réel / estimé)" };
  },
};

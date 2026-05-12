import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildBugExclusionFragment, buildDeliveredCte, buildExcludeIssueTypesFragment, buildWindowFragment, type DurationStats, placeholders, SECONDS_PER_DAY, statsFromDays, workingDaysBetween } from "./utils";

export interface CycleTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const cycleTimeNormalizedMetric: Metric<CycleTimeNormalizedResult> = {
  name: "cycle-time-normalized",
  description:
    "Cycle-time team (1er 'Développement en cours' -> 1er statut team-done) divisé par l'estimation. 1 = conforme, 2 = 2× plus long.",

  compute(db: Database.Database, config: MetricConfig): CycleTimeNormalizedResult {
    if (config.estimation.method !== "time") {
      return { count: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0,
        excludedOutliers: 0, unit: "ratio (cycle réel / estimé)", disabled: true } as CycleTimeNormalizedResult & { disabled: true };
    }
    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { bugSql, bugArgs } = buildBugExclusionFragment(config.bugIssueTypes);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, d.done_at, i.original_estimate_seconds
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        AND i.original_estimate_seconds > 0
        ${excludeSql} ${bugSql}
        ${cutoffSql} ${endSql}
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...excludeArgs,
      ...bugArgs,
      ...cutoffArgs,
      ...endArgs,
    ) as { started_at: string; done_at: string; original_estimate_seconds: number }[];

    const ratios: number[] = [];
    for (const r of rows) {
      const cycleDays = workingDaysBetween(r.started_at, r.done_at);
      if (cycleDays < 0) {continue;}
      const estimateDays = r.original_estimate_seconds / SECONDS_PER_DAY;
      ratios.push(cycleDays / estimateDays);
    }

    return { ...statsFromDays(ratios, config.excludeOutliers !== false), unit: "ratio (cycle réel / estimé)" };
  },
};

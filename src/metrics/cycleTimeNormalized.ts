import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { buildDeliveredCte, DurationStats, SECONDS_PER_DAY, statsFromDays, workingDaysBetween } from "./utils";

export interface CycleTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const cycleTimeNormalizedMetric: Metric<CycleTimeNormalizedResult> = {
  name: "cycle-time-normalized",
  description:
    "Cycle-time team (1er 'Développement en cours' -> 1er statut team-done) divisé par l'estimation. 1 = conforme, 2 = 2× plus long.",

  compute(db: Database.Database, config: MetricConfig): CycleTimeNormalizedResult {
    const todoPh = config.todoStatuses.map(() => "?").join(",");
    const devStartPh = config.devStartStatuses.map(() => "?").join(",");
    const delivered = buildDeliveredCte(config.doneStatuses);
    const cutoffSql = config.cutoffDate ? "AND d.done_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND d.done_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];
    const bugPh = config.bugIssueTypes.length > 0 ? config.bugIssueTypes.map(() => "?").join(",") : null;
    const bugSql = bugPh ? `AND i.issue_type NOT IN (${bugPh})` : "";
    const bugArgs = bugPh ? config.bugIssueTypes : [];

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, d.done_at, i.original_estimate_seconds
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        AND i.original_estimate_seconds > 0
        ${bugSql}
        ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...bugArgs,
      ...cutoffArgs,
      ...endArgs,
      ...config.todoStatuses,
    ) as Array<{ started_at: string; done_at: string; original_estimate_seconds: number }>;

    const ratios: number[] = [];
    for (const r of rows) {
      const cycleDays = workingDaysBetween(r.started_at, r.done_at);
      if (cycleDays < 0) continue;
      const estimateDays = r.original_estimate_seconds / SECONDS_PER_DAY;
      ratios.push(cycleDays / estimateDays);
    }

    return { ...statsFromDays(ratios, config.excludeOutliers !== false), unit: "ratio (cycle réel / estimé)" };
  },
};

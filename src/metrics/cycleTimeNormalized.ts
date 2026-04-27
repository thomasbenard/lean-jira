import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { DurationStats, SECONDS_PER_DAY, statsFromDays, workingDaysBetween } from "./utils";

export interface CycleTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const cycleTimeNormalizedMetric: Metric<CycleTimeNormalizedResult> = {
  name: "cycle-time-normalized",
  description:
    "Cycle-time dev (1er 'Développement en cours' -> livraison) divisé par l'estimation. 1 = conforme, 2 = 2× plus long.",

  compute(db: Database.Database, config: MetricConfig): CycleTimeNormalizedResult {
    const todoPh = config.todoStatuses.map(() => "?").join(",");
    const devStartPh = config.devStartStatuses.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND i.resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND i.resolved_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];
    const bugPh = config.bugIssueTypes.length > 0 ? config.bugIssueTypes.map(() => "?").join(",") : null;
    const bugSql = bugPh ? `AND i.issue_type NOT IN (${bugPh})` : "";
    const bugArgs = bugPh ? config.bugIssueTypes : [];

    const rows = db.prepare(`
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, i.resolved_at, i.original_estimate_seconds
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        AND i.resolved_at IS NOT NULL
        AND i.original_estimate_seconds > 0
        ${bugSql}
        ${cutoffSql}
        ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key
    `).all(...config.devStartStatuses, ...bugArgs, ...cutoffArgs, ...endArgs, ...config.todoStatuses) as Array<{
      started_at: string;
      resolved_at: string;
      original_estimate_seconds: number;
    }>;

    const ratios: number[] = [];
    for (const r of rows) {
      const cycleDays = workingDaysBetween(r.started_at, r.resolved_at);
      if (cycleDays < 0) continue;
      const estimateDays = r.original_estimate_seconds / SECONDS_PER_DAY;
      ratios.push(cycleDays / estimateDays);
    }

    return { ...statsFromDays(ratios, config.excludeOutliers !== false), unit: "ratio (cycle réel / estimé)" };
  },
};

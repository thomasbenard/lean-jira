import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { DurationStats, SECONDS_PER_DAY, statsFromDays } from "./utils";

export interface CycleTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const cycleTimeNormalizedMetric: Metric<CycleTimeNormalizedResult> = {
  name: "cycle-time-normalized",
  description:
    "Cycle-time réel divisé par l'estimation originale. Indique la dérive vs estimation (1 = on time, 2 = 2× plus long).",

  compute(db: Database.Database, config: MetricConfig): CycleTimeNormalizedResult {
    const inProgressPh = config.inProgressStatuses.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND i.resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];

    const rows = db.prepare(`
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, i.resolved_at, i.original_estimate_seconds
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${inProgressPh})
        AND i.resolved_at IS NOT NULL
        AND i.original_estimate_seconds > 0
        ${cutoffSql}
      GROUP BY t.issue_key
    `).all(...config.inProgressStatuses, ...cutoffArgs) as Array<{
      started_at: string;
      resolved_at: string;
      original_estimate_seconds: number;
    }>;

    const ratios: number[] = [];
    for (const r of rows) {
      const cycleDays = (new Date(r.resolved_at).getTime() - new Date(r.started_at).getTime()) / 86_400_000;
      if (cycleDays < 0) continue;
      const estimateDays = r.original_estimate_seconds / SECONDS_PER_DAY;
      ratios.push(cycleDays / estimateDays);
    }

    return { ...statsFromDays(ratios), unit: "ratio (cycle réel / estimé)" };
  },
};

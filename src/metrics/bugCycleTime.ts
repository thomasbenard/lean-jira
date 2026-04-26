import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { DurationStats, statsFromDays } from "./utils";

export interface BugCycleTimeResult extends DurationStats {
  unit: string;
}

export const bugCycleTimeMetric: Metric<BugCycleTimeResult> = {
  name: "bug-cycle-time",
  description:
    "Cycle-time des bugs (1er 'Développement en cours' -> livraison). Mesure la réactivité aux incidents.",

  compute(db: Database.Database, config: MetricConfig): BugCycleTimeResult {
    if (config.bugIssueTypes.length === 0) {
      return { ...statsFromDays([]), unit: "j" };
    }

    const devStartPh = config.devStartStatuses.map(() => "?").join(",");
    const bugPh = config.bugIssueTypes.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND i.resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND i.resolved_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    const rows = db.prepare(`
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, i.resolved_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        AND i.resolved_at IS NOT NULL
        AND i.issue_type IN (${bugPh})
        ${cutoffSql}
        ${endSql}
      GROUP BY t.issue_key
    `).all(...config.devStartStatuses, ...config.bugIssueTypes, ...cutoffArgs, ...endArgs) as Array<{
      started_at: string;
      resolved_at: string;
    }>;

    const days: number[] = [];
    for (const r of rows) {
      const d = (new Date(r.resolved_at).getTime() - new Date(r.started_at).getTime()) / 86_400_000;
      if (d >= 0) days.push(d);
    }

    return { ...statsFromDays(days, config.excludeOutliers !== false), unit: "j" };
  },
};

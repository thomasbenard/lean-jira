import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { DurationStats, statsFromDays, workingDaysBetween } from "./utils";

export interface CycleTimeResult {
  issueKey: string;
  startedAt: string;
  resolvedAt: string;
  cycleTimeDays: number;
}

export interface CycleTimeSummary extends DurationStats {
  issues: CycleTimeResult[];
}

export const cycleTimeMetric: Metric<CycleTimeSummary> = {
  name: "cycle-time",
  description: "Durée de dev actif (1er passage en 'Développement en cours' -> livraison). Exclut attente backlog et design. Cf. lead-time pour délai total.",

  compute(db: Database.Database, config: MetricConfig): CycleTimeSummary {
    const devStartPh = config.devStartStatuses.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND i.resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND i.resolved_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    // resolved_at vient du champ Jira `resolutiondate`, préservé à travers les migrations
    // workflow (les transitions vers Done en bulk close ne le modifient pas).
    const rows = db.prepare(`
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, i.resolved_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${devStartPh}) AND i.resolved_at IS NOT NULL ${cutoffSql} ${endSql}
      GROUP BY t.issue_key
    `).all(...config.devStartStatuses, ...cutoffArgs, ...endArgs) as Array<{ issue_key: string; started_at: string; resolved_at: string }>;

    const issues: CycleTimeResult[] = [];
    for (const r of rows) {
      if (new Date(r.resolved_at) < new Date(r.started_at)) continue;
      issues.push({
        issueKey: r.issue_key,
        startedAt: r.started_at,
        resolvedAt: r.resolved_at,
        cycleTimeDays: workingDaysBetween(r.started_at, r.resolved_at),
      });
    }

    const stats = statsFromDays(issues.map((i) => i.cycleTimeDays), config.excludeOutliers !== false);
    return { ...stats, issues };
  },
};


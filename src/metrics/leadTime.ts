import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { DurationStats, statsFromDays } from "./utils";

export interface LeadTimeResult {
  issueKey: string;
  todoAt: string;
  resolvedAt: string;
  leadTimeDays: number;
}

export interface LeadTimeSummary extends DurationStats {
  issues: LeadTimeResult[];
}

export const leadTimeMetric: Metric<LeadTimeSummary> = {
  name: "lead-time",
  description: "Délai total backlog -> livraison (entrée en TODO inclus). Inclut attente, design, dev. Cf. cycle-time pour dev seul.",

  compute(db: Database.Database, config: MetricConfig): LeadTimeSummary {
    const todoPh = config.todoStatuses.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND i.resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND i.resolved_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    // resolved_at vient du champ Jira `resolutiondate`, préservé à travers les migrations
    // workflow (les transitions vers Done en bulk close ne le modifient pas).
    const rows = db.prepare(`
      SELECT t.issue_key, MIN(t.transitioned_at) AS todo_at, i.resolved_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${todoPh}) AND i.resolved_at IS NOT NULL ${cutoffSql} ${endSql}
      GROUP BY t.issue_key
    `).all(...config.todoStatuses, ...cutoffArgs, ...endArgs) as Array<{ issue_key: string; todo_at: string; resolved_at: string }>;

    const issues: LeadTimeResult[] = [];
    for (const r of rows) {
      if (new Date(r.resolved_at).getTime() < new Date(r.todo_at).getTime()) continue;
      issues.push({
        issueKey: r.issue_key,
        todoAt: r.todo_at,
        resolvedAt: r.resolved_at,
        leadTimeDays: diffDays(r.todo_at, r.resolved_at),
      });
    }

    const stats = statsFromDays(issues.map((i) => i.leadTimeDays), config.excludeOutliers !== false);
    return { ...stats, issues };
  },
};

function diffDays(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
}

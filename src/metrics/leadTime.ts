import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildExcludeIssueTypesFragment, buildWindowFragment, type DurationStats, placeholders, statsFromDays, workingDaysBetween } from "./utils";

export interface LeadTimeResult {
  issueKey: string;
  todoAt: string;
  resolvedAt: string; // = done_at (1ère transition team-done)
  leadTimeDays: number;
}

export interface LeadTimeSummary extends DurationStats {
  issues: LeadTimeResult[];
}

export const leadTimeMetric: Metric<LeadTimeSummary> = {
  name: "lead-time",
  description:
    "Délai total backlog -> livraison équipe (entrée en TODO -> 1er statut team-done). Inclut attente backlog, design, dev. Cf. cycle-time pour dev seul.",

  compute(db: Database.Database, config: MetricConfig): LeadTimeSummary {
    const todoPh = placeholders(config.todoStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    // EXISTS garantit la même population que cycle-time (issues avec les deux transitions).
    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS todo_at, d.done_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${todoPh})
        ${excludeSql} ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${devStartPh}))
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.todoStatuses,
      ...excludeArgs,
      ...cutoffArgs,
      ...endArgs,
      ...config.devStartStatuses,
    ) as { issue_key: string; todo_at: string; done_at: string }[];

    const issues: LeadTimeResult[] = [];
    for (const r of rows) {
      if (r.done_at < r.todo_at) {continue;}
      issues.push({
        issueKey: r.issue_key,
        todoAt: r.todo_at,
        resolvedAt: r.done_at,
        leadTimeDays: workingDaysBetween(r.todo_at, r.done_at),
      });
    }

    const stats = statsFromDays(issues.map((i) => i.leadTimeDays), config.excludeOutliers !== false);
    return { ...stats, issues };
  },
};

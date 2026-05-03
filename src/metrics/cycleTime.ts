import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildExcludeIssueTypesFragment, buildWindowFragment, type DurationStats, placeholders, statsFromDays, workingDaysBetween } from "./utils";

export interface CycleTimeResult {
  issueKey: string;
  startedAt: string;
  resolvedAt: string; // = done_at (1ère transition team-done) ; nom conservé pour rétro-compat consommateurs
  cycleTimeDays: number;
}

export interface CycleTimeSummary extends DurationStats {
  issues: CycleTimeResult[];
}

export const cycleTimeMetric: Metric<CycleTimeSummary> = {
  name: "cycle-time",
  description:
    "Durée de dev actif (1er passage en 'Développement en cours' -> 1er passage en statut team-done). Exclut attente backlog, design, et la queue post-dev (validation PO, mise en prod) qui sort du périmètre équipe. Cf. lead-time pour délai total.",

  compute(db: Database.Database, config: MetricConfig): CycleTimeSummary {
    const todoPh = placeholders(config.todoStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    // EXISTS garantit la même population que lead-time. JOIN delivered élimine
    // les issues sans transition vers un statut team-done (toujours en cours).
    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, d.done_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${excludeSql} ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...excludeArgs,
      ...cutoffArgs,
      ...endArgs,
      ...config.todoStatuses,
    ) as { issue_key: string; started_at: string; done_at: string }[];

    const issues: CycleTimeResult[] = [];
    for (const r of rows) {
      if (r.done_at < r.started_at) {continue;}
      issues.push({
        issueKey: r.issue_key,
        startedAt: r.started_at,
        resolvedAt: r.done_at,
        cycleTimeDays: workingDaysBetween(r.started_at, r.done_at),
      });
    }

    const stats = statsFromDays(issues.map((i) => i.cycleTimeDays), config.excludeOutliers !== false);
    return { ...stats, issues };
  },
};

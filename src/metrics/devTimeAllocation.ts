import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { avg, buildDeliveredCte, buildWindowFragment, placeholders, workingDaysBetween } from "./utils";

export interface DevTimeAllocationByWeek {
  week: string;
  featureDays: number;
  bugDays: number;
  bugRatio: number;
}

export interface DevTimeAllocationSummary {
  byWeek: DevTimeAllocationByWeek[];
  avgBugRatio: number;
}

function isoWeek(dateISO: string): string {
  const d = new Date(dateISO.length <= 10 ? dateISO + "T00:00:00Z" : dateISO);
  // ISO week: Thu determines the year. Shift to nearest Thu.
  const day = d.getUTCDay() || 7; // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

export const devTimeAllocationMetric: Metric<DevTimeAllocationSummary> = {
  name: "dev-time-allocation",
  description:
    "Somme des cycle times livrés par semaine, split features vs bugs. bugRatio = bugDays / totalDays. Hausse = dérive vers mode pompier.",

  compute(db: Database.Database, config: MetricConfig): DevTimeAllocationSummary {
    const todoPh = placeholders(config.todoStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key,
             MIN(t.transitioned_at) AS started_at,
             d.done_at,
             i.issue_type
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2
                    WHERE t2.issue_key = t.issue_key
                      AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key, d.done_at, i.issue_type
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...cutoffArgs,
      ...endArgs,
      ...config.todoStatuses,
    ) as Array<{ issue_key: string; started_at: string; done_at: string; issue_type: string }>;

    const bugTypes = new Set(config.bugIssueTypes);
    const byWeekMap = new Map<string, { featureDays: number; bugDays: number }>();

    for (const r of rows) {
      if (r.done_at < r.started_at) continue;
      const days = workingDaysBetween(r.started_at, r.done_at);
      const week = isoWeek(r.done_at);
      if (!byWeekMap.has(week)) byWeekMap.set(week, { featureDays: 0, bugDays: 0 });
      const entry = byWeekMap.get(week)!;
      if (bugTypes.has(r.issue_type)) entry.bugDays += days;
      else entry.featureDays += days;
    }

    const byWeek: DevTimeAllocationByWeek[] = Array.from(byWeekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, { featureDays, bugDays }]) => {
        const total = featureDays + bugDays;
        return { week, featureDays, bugDays, bugRatio: total > 0 ? bugDays / total : 0 };
      });

    return { byWeek, avgBugRatio: avg(byWeek.map((w) => w.bugRatio)) };
  },
};

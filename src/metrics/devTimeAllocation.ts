import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildExcludeIssueTypesFragment, buildWindowFragment, isoWeek, placeholders, workingDaysBetween } from "./utils";
import { now } from "../clock";

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

function accumulateWeeks(
  startedAt: string,
  doneAt: string,
  isBug: boolean,
  byWeekMap: Map<string, { featureDays: number; bugDays: number }>,
): void {
  const days = workingDaysBetween(startedAt, doneAt);
  if (days <= 0) {return;}
  for (const [week, alloc] of distributeAcrossWeeks(startedAt, doneAt, days)) {
    let entry = byWeekMap.get(week);
    if (!entry) {
      entry = { featureDays: 0, bugDays: 0 };
      byWeekMap.set(week, entry);
    }
    if (isBug) {entry.bugDays += alloc;}
    else {entry.featureDays += alloc;}
  }
}

function distributeAcrossWeeks(startedAt: string, doneAt: string, totalDays: number): Map<string, number> {
  const result = new Map<string, number>();
  if (totalDays <= 0) {return result;}
  const doneWeek = isoWeek(doneAt);
  const d = new Date(startedAt.length <= 10 ? startedAt + "T00:00:00Z" : startedAt);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1)); // rewind to Monday of start week
  let remaining = totalDays;
  while (remaining > 0) {
    const week = isoWeek(d.toISOString().slice(0, 10));
    const isLast = week === doneWeek;
    const alloc = isLast ? remaining : Math.min(5, remaining);
    result.set(week, (result.get(week) ?? 0) + alloc);
    remaining -= alloc;
    if (isLast) {break;}
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return result;
}

export const devTimeAllocationMetric: Metric<DevTimeAllocationSummary> = {
  name: "dev-time-allocation",
  description:
    "Somme des cycle times livrés + WIP en cours par semaine, split features vs bugs. bugRatio = bugDays / totalDays. Hausse = dérive vers mode pompier.",

  compute(db: Database.Database, config: MetricConfig): DevTimeAllocationSummary {
    const todoPh = placeholders(config.todoStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const donePh = placeholders(config.doneStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    // windowEndDate absent en mode live → date du jour réelle ; snapshot toujours fourni par compute.ts
    const today = config.windowEndDate ?? now().toISOString().slice(0, 10);

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
        ${excludeSql} ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2
                    WHERE t2.issue_key = t.issue_key
                      AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key, d.done_at, i.issue_type
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...excludeArgs,
      ...cutoffArgs,
      ...endArgs,
      ...config.todoStatuses,
    ) as { issue_key: string; started_at: string; done_at: string; issue_type: string }[];

    const wipRows = db.prepare(`
      SELECT t.issue_key,
             MIN(t.transitioned_at) AS started_at,
             i.issue_type
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${excludeSql}
        AND substr(t.transitioned_at, 1, 10) <= ?
        AND EXISTS (SELECT 1 FROM transitions t2
                    WHERE t2.issue_key = t.issue_key
                      AND t2.to_status IN (${todoPh}))
        AND NOT EXISTS (SELECT 1 FROM transitions td
                        WHERE td.issue_key = t.issue_key
                          AND td.to_status IN (${donePh})
                          AND substr(td.transitioned_at, 1, 10) <= ?)
      GROUP BY t.issue_key, i.issue_type
    `).all(
      ...config.devStartStatuses,
      ...excludeArgs,
      today,
      ...config.todoStatuses,
      ...config.doneStatuses,
      today,
    ) as { issue_key: string; started_at: string; issue_type: string }[];

    const bugTypes = new Set(config.bugIssueTypes);
    const byWeekMap = new Map<string, { featureDays: number; bugDays: number }>();

    for (const r of rows) {
      accumulateWeeks(r.started_at, r.done_at, bugTypes.has(r.issue_type), byWeekMap);
    }
    for (const r of wipRows) {
      accumulateWeeks(r.started_at, today, bugTypes.has(r.issue_type), byWeekMap);
    }

    const byWeek: DevTimeAllocationByWeek[] = Array.from(byWeekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, { featureDays, bugDays }]) => {
        const total = featureDays + bugDays;
        return { week, featureDays, bugDays, bugRatio: total > 0 ? bugDays / total : 0 };
      });

    const totalBugDays = byWeek.reduce((s, w) => s + w.bugDays, 0);
    const totalDays = byWeek.reduce((s, w) => s + w.featureDays + w.bugDays, 0);
    return { byWeek, avgBugRatio: totalDays > 0 ? totalBugDays / totalDays : 0 };
  },
};

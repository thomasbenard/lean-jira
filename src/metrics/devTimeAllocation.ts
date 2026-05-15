import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { isoWeek, workingDaysBetween } from "./utils";
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

export function distributeAcrossWeeks(startedAt: string, doneAt: string, totalDays: number): Map<string, number> {
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

  compute(ctx: MetricsContext): DevTimeAllocationSummary {
    const config = ctx.config;
    const bugTypes = new Set(config.bugIssueTypes);
    const devStartSet = new Set(config.devStartStatuses);
    const byWeekMap = new Map<string, { featureDays: number; bugDays: number }>();

    // windowEndDate absent en mode live → date du jour réelle ; snapshot toujours fourni par compute.ts
    const today = config.windowEndDate ?? now().toISOString().slice(0, 10);

    // Issues livrées : population cycle-time (déjà filtrée cutoff/window/devStart/excludeIssueTypes)
    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      accumulateWeeks(sample.startedAt, sample.doneAt, bugTypes.has(issue.issueType), byWeekMap);
    }

    // WIP : items entrés en dev avant `today` et non livrés à `today`
    // pourquoi : transitionsByIssue exclut déjà les issueTypes filtrés via excludeIssueTypes
    for (const [key, list] of ctx.transitionsByIssue) {
      const devStart = list.find((t) => devStartSet.has(t.toStatus));
      if (!devStart) { continue; }
      if (devStart.transitionedAt.slice(0, 10) > today) { continue; }
      const doneAt = ctx.deliveredAt.get(key);
      if (doneAt && doneAt.slice(0, 10) <= today) { continue; }
      const issue = ctx.issueByKey.get(key);
      if (!issue) { continue; }
      accumulateWeeks(devStart.transitionedAt, today, bugTypes.has(issue.issueType), byWeekMap);
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

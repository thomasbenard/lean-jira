import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, statsFromDays } from "./utils";

export interface CycleTimeIssue {
  issueKey: string;
  startedAt: string;
  resolvedAt: string; // = done_at (1ère transition team-done) ; nom conservé pour rétro-compat consommateurs
  cycleTimeDays: number;
}

export interface CycleTimeSummary extends DurationStats {
  issues: CycleTimeIssue[];
}

export const cycleTimeMetric: Metric<CycleTimeSummary> = {
  name: "cycle-time",
  description: "Temps de dev (1ère entrée en In Progress → team-done)",

  compute(ctx: MetricsContext): CycleTimeSummary {
    // pourquoi : filtre des anomalies de données (done_at < started_at) — ex. transition Done avant 1ère entrée en In Progress
    const issues: CycleTimeIssue[] = ctx.cycleTimePopulation
      .filter((s) => s.doneAt >= s.startedAt)
      .map((s) => ({
        issueKey: s.issueKey,
        startedAt: s.startedAt,
        resolvedAt: s.doneAt,
        cycleTimeDays: ctx.workingDaysBetween(s.startedAt, s.doneAt),
      }));
    issues.sort((a, b) => a.issueKey.localeCompare(b.issueKey));
    const stats = statsFromDays(
      issues.map((i) => i.cycleTimeDays),
      ctx.config.excludeOutliers !== false,
    );
    return { ...stats, issues };
  },
};

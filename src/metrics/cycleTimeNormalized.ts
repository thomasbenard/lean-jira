import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, SECONDS_PER_DAY, statsFromDays } from "./utils";

export interface CycleTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const cycleTimeNormalizedMetric: Metric<CycleTimeNormalizedResult> = {
  name: "cycle-time-normalized",
  description:
    "Cycle-time team (1er 'Développement en cours' -> 1er statut team-done) divisé par l'estimation. 1 = conforme, 2 = 2× plus long.",

  compute(ctx: MetricsContext): CycleTimeNormalizedResult {
    if (ctx.config.estimation.method !== "time") {
      return { count: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0,
        excludedOutliers: 0, unit: "ratio (cycle réel / estimé)", disabled: true } as CycleTimeNormalizedResult & { disabled: true };
    }
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const ratios: number[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      if (bugSet.has(issue.issueType)) { continue; }
      const estimateSeconds = issue.originalEstimateSeconds;
      if (estimateSeconds === null || estimateSeconds <= 0) { continue; }
      const cycleDays = ctx.workingDaysBetween(sample.startedAt, sample.doneAt);
      if (cycleDays < 0) { continue; }
      const estimateDays = estimateSeconds / SECONDS_PER_DAY;
      ratios.push(cycleDays / estimateDays);
    }
    return { ...statsFromDays(ratios, ctx.config.excludeOutliers !== false), unit: "ratio (cycle réel / estimé)" };
  },
};

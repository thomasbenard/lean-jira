import { type Metric } from "./types";
import { type DurationStats, statsFromDays } from "./utils";
import type { MetricsContext } from "./context";

export interface BugCycleTimeResult extends DurationStats {
  unit: string;
}

export const bugCycleTimeMetric: Metric<BugCycleTimeResult> = {
  name: "bug-cycle-time",
  description:
    "Cycle-time des bugs (1er 'Développement en cours' -> 1er statut team-done). Mesure la réactivité aux incidents.",

  compute(ctx: MetricsContext): BugCycleTimeResult {
    if (ctx.config.bugIssueTypes.length === 0) {
      return { ...statsFromDays([]), unit: "j" };
    }

    const bugSet = new Set(ctx.config.bugIssueTypes);
    const days: number[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      if (!bugSet.has(issue.issueType)) { continue; }
      const d = ctx.workingDaysBetween(sample.startedAt, sample.doneAt);
      if (d >= 0) { days.push(d); }
    }

    return { ...statsFromDays(days, ctx.config.excludeOutliers !== false), unit: "j" };
  },
};

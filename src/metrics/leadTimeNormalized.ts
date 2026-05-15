import { type Metric } from "./types";
import { type MetricsContext } from "./context";
import { type DurationStats, SECONDS_PER_DAY, statsFromDays } from "./utils";

export interface LeadTimeNormalizedResult extends DurationStats {
  unit: string;
}

export const leadTimeNormalizedMetric: Metric<LeadTimeNormalizedResult> = {
  name: "lead-time-normalized",
  description:
    "Lead-time total (backlog -> 1er statut team-done) divisé par l'estimation. Inclut attente. Cf. cycle-time-normalized pour dérive dev seul.",

  compute(ctx: MetricsContext): LeadTimeNormalizedResult {
    if (ctx.config.estimation.method !== "time") {
      return { count: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0,
        excludedOutliers: 0, unit: "ratio (lead réel / estimé)", disabled: true } as LeadTimeNormalizedResult & { disabled: true };
    }
    const todoSet = new Set(ctx.config.todoStatuses);
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const ratios: number[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      if (bugSet.has(issue.issueType)) { continue; }
      const estimateSeconds = issue.originalEstimateSeconds;
      if (estimateSeconds === null || estimateSeconds <= 0) { continue; }
      const transitions = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      const todoTransition = transitions.find((t) => todoSet.has(t.toStatus));
      if (!todoTransition) { continue; }
      const leadDays = ctx.workingDaysBetween(todoTransition.transitionedAt, sample.doneAt);
      if (leadDays < 0) { continue; }
      const estimateDays = estimateSeconds / SECONDS_PER_DAY;
      ratios.push(leadDays / estimateDays);
    }
    return { ...statsFromDays(ratios, ctx.config.excludeOutliers !== false), unit: "ratio (lead réel / estimé)" };
  },
};

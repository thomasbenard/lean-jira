import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import {
  bucketize,
  BUCKET_ORDER,
  type DurationStats,
  type SizeBucket,
  statsFromDays,
} from "./utils";

export interface LeadTimeBySizeResult {
  buckets: Partial<Record<SizeBucket, DurationStats>>;
}

export const leadTimeBySizeMetric: Metric<LeadTimeBySizeResult> = {
  name: "lead-time-by-size",
  description:
    "Lead-time total (backlog -> 1er statut team-done) par bucket de taille. Inclut toute l'attente. Cf. cycle-time-by-size pour dev seul.",

  compute(ctx: MetricsContext): LeadTimeBySizeResult {
    const todoSet = new Set(ctx.config.todoStatuses);
    const bugTypes = new Set(ctx.config.bugIssueTypes);
    const daysByBucket = new Map<SizeBucket, number[]>();

    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      const transitions = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      const todoTransition = transitions.find((t) => todoSet.has(t.toStatus));
      if (!todoTransition) { continue; }
      if (sample.doneAt < todoTransition.transitionedAt) { continue; }
      const days = ctx.workingDaysBetween(todoTransition.transitionedAt, sample.doneAt);
      if (days < 0) { continue; }
      const bucket = bucketize(
        {
          originalEstimateSeconds: issue.originalEstimateSeconds,
          storyPoints: issue.storyPoints,
          sizeLabel: issue.sizeLabel,
        },
        bugTypes.has(issue.issueType),
        ctx.config.estimation,
      );
      let list = daysByBucket.get(bucket);
      if (!list) {
        list = [];
        daysByBucket.set(bucket, list);
      }
      list.push(days);
    }

    const buckets: Partial<Record<SizeBucket, DurationStats>> = {};
    const excludeOutliers = ctx.config.excludeOutliers !== false;
    for (const b of BUCKET_ORDER) {
      const days = daysByBucket.get(b);
      if (days && days.length > 0) {
        buckets[b] = statsFromDays(days, excludeOutliers);
      }
    }

    return { buckets };
  },
};

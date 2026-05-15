import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import {
  bucketize,
  BUCKET_ORDER,
  type DurationStats,
  type SizeBucket,
  statsFromDays,
} from "./utils";

export interface CycleTimeBySizeResult {
  buckets: Partial<Record<SizeBucket, DurationStats>>;
}

export const cycleTimeBySizeMetric: Metric<CycleTimeBySizeResult> = {
  name: "cycle-time-by-size",
  description:
    "Cycle-time par bucket de taille (1er 'Développement en cours' -> 1er statut team-done). Exclut attente backlog, design et queue post-dev.",

  compute(ctx: MetricsContext): CycleTimeBySizeResult {
    const bugTypes = new Set(ctx.config.bugIssueTypes);
    const daysByBucket = new Map<SizeBucket, number[]>();

    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      const days = ctx.workingDaysBetween(sample.startedAt, sample.doneAt);
      if (days < 0) { continue; }
      const bucket = bucketize(
        { originalEstimateSeconds: issue.originalEstimateSeconds, storyPoints: issue.storyPoints, sizeLabel: issue.sizeLabel },
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

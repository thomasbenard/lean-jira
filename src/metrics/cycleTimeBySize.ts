import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import {
  buildDeliveredCte,
  buildExcludeIssueTypesFragment,
  buildWindowFragment,
  bucketize,
  BUCKET_ORDER,
  type DurationStats,
  placeholders,
  type SizeBucket,
  statsFromDays,
  workingDaysBetween,
} from "./utils";

export interface CycleTimeBySizeResult {
  buckets: Partial<Record<SizeBucket, DurationStats>>;
}

export const cycleTimeBySizeMetric: Metric<CycleTimeBySizeResult> = {
  name: "cycle-time-by-size",
  description:
    "Cycle-time par bucket de taille (1er 'Développement en cours' -> 1er statut team-done). Exclut attente backlog, design et queue post-dev.",

  compute(db: Database.Database, config: MetricConfig): CycleTimeBySizeResult {
    const todoPh = placeholders(config.todoStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, d.done_at,
             i.original_estimate_seconds, i.story_points, i.size_label, i.issue_type
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
    ) as {
      issue_key: string;
      started_at: string;
      done_at: string;
      original_estimate_seconds: number | null;
      story_points: number | null;
      size_label: string | null;
      issue_type: string;
    }[];

    const bugTypes = new Set(config.bugIssueTypes);
    const daysByBucket = new Map<SizeBucket, number[]>();
    for (const r of rows) {
      const days = workingDaysBetween(r.started_at, r.done_at);
      if (days < 0) {continue;}
      const bucket = bucketize(
        { originalEstimateSeconds: r.original_estimate_seconds, storyPoints: r.story_points, sizeLabel: r.size_label },
        bugTypes.has(r.issue_type),
        config.estimation,
      );
      const list = daysByBucket.get(bucket) ?? [];
      list.push(days);
      daysByBucket.set(bucket, list);
    }

    const buckets: Partial<Record<SizeBucket, DurationStats>> = {};
    const excludeOutliers = config.excludeOutliers !== false;
    for (const b of BUCKET_ORDER) {
      const days = daysByBucket.get(b);
      if (days && days.length > 0) {buckets[b] = statsFromDays(days, excludeOutliers);}
    }

    return { buckets };
  },
};

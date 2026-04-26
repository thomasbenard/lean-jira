import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { bucketize, BUCKET_ORDER, DurationStats, SizeBucket, statsFromDays } from "./utils";

export interface CycleTimeBySizeResult {
  buckets: Partial<Record<SizeBucket, DurationStats>>;
}

export const cycleTimeBySizeMetric: Metric<CycleTimeBySizeResult> = {
  name: "cycle-time-by-size",
  description: "Cycle-time agrégé par bucket de taille (estimation originale).",

  compute(db: Database.Database, config: MetricConfig): CycleTimeBySizeResult {
    const inProgressPh = config.inProgressStatuses.map(() => "?").join(",");
    const cutoffSql = config.cutoffDate ? "AND i.resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];

    const rows = db.prepare(`
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, i.resolved_at, i.original_estimate_seconds
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE t.to_status IN (${inProgressPh}) AND i.resolved_at IS NOT NULL ${cutoffSql}
      GROUP BY t.issue_key
    `).all(...config.inProgressStatuses, ...cutoffArgs) as Array<{
      issue_key: string;
      started_at: string;
      resolved_at: string;
      original_estimate_seconds: number | null;
    }>;

    const daysByBucket = new Map<SizeBucket, number[]>();
    for (const r of rows) {
      const days = (new Date(r.resolved_at).getTime() - new Date(r.started_at).getTime()) / 86_400_000;
      if (days < 0) continue;
      const bucket = bucketize(r.original_estimate_seconds);
      const list = daysByBucket.get(bucket) ?? [];
      list.push(days);
      daysByBucket.set(bucket, list);
    }

    const buckets: Partial<Record<SizeBucket, DurationStats>> = {};
    const excludeOutliers = config.excludeOutliers !== false;
    for (const b of BUCKET_ORDER) {
      const days = daysByBucket.get(b);
      if (days && days.length > 0) buckets[b] = statsFromDays(days, excludeOutliers);
    }

    return { buckets };
  },
};

import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import {
  buildDeliveredCte,
  bucketize,
  BUCKET_ORDER,
  DurationStats,
  SizeBucket,
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
    const todoPh = config.todoStatuses.map(() => "?").join(",");
    const devStartPh = config.devStartStatuses.map(() => "?").join(",");
    const delivered = buildDeliveredCte(config.doneStatuses);
    const cutoffSql = config.cutoffDate ? "AND d.done_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND d.done_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT t.issue_key, MIN(t.transitioned_at) AS started_at, d.done_at,
             i.original_estimate_seconds, i.issue_type
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...cutoffArgs,
      ...endArgs,
      ...config.todoStatuses,
    ) as Array<{
      issue_key: string;
      started_at: string;
      done_at: string;
      original_estimate_seconds: number | null;
      issue_type: string;
    }>;

    const bugTypes = new Set(config.bugIssueTypes);
    const daysByBucket = new Map<SizeBucket, number[]>();
    for (const r of rows) {
      const days = workingDaysBetween(r.started_at, r.done_at);
      if (days < 0) continue;
      const bucket = bucketize(r.original_estimate_seconds, bugTypes.has(r.issue_type));
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

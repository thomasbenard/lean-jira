import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { SECONDS_PER_DAY } from "./utils";

export interface ThroughputWeightedByWeek {
  week: string;
  estimatedDays: number;
  estimatedCount: number;
  unestimatedCount: number;
}

export interface ThroughputWeightedSummary {
  byWeek: ThroughputWeightedByWeek[];
  avgPerWeek: number;
}

export const throughputWeightedMetric: Metric<ThroughputWeightedSummary> = {
  name: "throughput-weighted",
  description:
    "Débit pondéré par l'estimation: somme des jours-personnes estimés livrés par semaine. Affiche aussi la part non estimée.",

  compute(db: Database.Database, config: MetricConfig): ThroughputWeightedSummary {
    const cutoffSql = config.cutoffDate ? "AND resolved_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];

    const rows = db.prepare(`
      SELECT
        strftime('%Y-W%W', substr(resolved_at, 1, 10)) AS week,
        SUM(CASE WHEN original_estimate_seconds > 0 THEN original_estimate_seconds ELSE 0 END) AS total_seconds,
        SUM(CASE WHEN original_estimate_seconds > 0 THEN 1 ELSE 0 END) AS estimated_count,
        SUM(CASE WHEN original_estimate_seconds IS NULL OR original_estimate_seconds <= 0 THEN 1 ELSE 0 END) AS unestimated_count
      FROM issues
      WHERE resolved_at IS NOT NULL ${cutoffSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...cutoffArgs) as Array<{
      week: string;
      total_seconds: number;
      estimated_count: number;
      unestimated_count: number;
    }>;

    const byWeek: ThroughputWeightedByWeek[] = rows.map((r) => ({
      week: r.week,
      estimatedDays: r.total_seconds / SECONDS_PER_DAY,
      estimatedCount: r.estimated_count,
      unestimatedCount: r.unestimated_count,
    }));

    const totalDays = byWeek.reduce((sum, w) => sum + w.estimatedDays, 0);
    const avgPerWeek = byWeek.length > 0 ? totalDays / byWeek.length : 0;

    return { byWeek, avgPerWeek };
  },
};

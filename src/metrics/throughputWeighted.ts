import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { buildBugExclusionFragment, buildDeliveredCte, buildWindowFragment, SECONDS_PER_DAY } from "./utils";

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
    "Débit pondéré par l'estimation : somme des jours-personnes estimés livrés par semaine (1ère transition team-done). Affiche aussi la part non estimée.",

  compute(db: Database.Database, config: MetricConfig): ThroughputWeightedSummary {
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { bugSql, bugArgs } = buildBugExclusionFragment(config.bugIssueTypes);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT
        strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week,
        SUM(CASE WHEN i.original_estimate_seconds > 0 THEN i.original_estimate_seconds ELSE 0 END) AS total_seconds,
        SUM(CASE WHEN i.original_estimate_seconds > 0 THEN 1 ELSE 0 END) AS estimated_count,
        SUM(CASE WHEN i.original_estimate_seconds IS NULL OR i.original_estimate_seconds <= 0 THEN 1 ELSE 0 END) AS unestimated_count
      FROM delivered d
      JOIN issues i ON i.key = d.issue_key
      WHERE 1=1 ${bugSql} ${cutoffSql} ${endSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...delivered.args, ...bugArgs, ...cutoffArgs, ...endArgs) as Array<{
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

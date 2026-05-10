import type Database from "better-sqlite3";
import { type Metric, type MetricConfig, type EstimationMethod } from "./types";
import { buildBugExclusionFragment, buildDeliveredCte, buildExcludeIssueTypesFragment, buildWindowFragment, SECONDS_PER_DAY } from "./utils";

export interface ThroughputWeightedByWeek {
  week: string;
  estimatedDays: number;
  estimatedCount: number;
  unestimatedCount: number;
}

export interface ThroughputWeightedSummary {
  byWeek: ThroughputWeightedByWeek[];
  avgPerWeek: number;
  unit: "j-h" | "SP" | "pts";
  disabled: boolean;
}

type WeightedConfig =
  | { disabled: true }
  | { disabled: false; col: "original_estimate_seconds" | "story_points"; unit: "j-h" | "SP" | "pts" };

function resolveWeightedConfig(method: EstimationMethod): WeightedConfig {
  if (method === "t-shirt" || method === "none") { return { disabled: true }; }
  if (method === "time")         { return { disabled: false, col: "original_estimate_seconds", unit: "j-h" }; }
  if (method === "story-points") { return { disabled: false, col: "story_points", unit: "SP" }; }
  return { disabled: false, col: "story_points", unit: "pts" };
}

export const throughputWeightedMetric: Metric<ThroughputWeightedSummary> = {
  name: "throughput-weighted",
  description:
    "Débit pondéré par l'estimation : somme des unités estimées livrées par semaine (1ère transition team-done). Affiche aussi la part non estimée.",

  compute(db: Database.Database, config: MetricConfig): ThroughputWeightedSummary {
    const wcfg = resolveWeightedConfig(config.estimation.method);

    if (wcfg.disabled) {
      return { byWeek: [], avgPerWeek: 0, unit: "j-h", disabled: true };
    }

    const { col, unit } = wcfg;
    const isNull = `(i.${col} IS NULL OR i.${col} <= 0)`;
    const isPos  = `(i.${col} > 0)`;

    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { bugSql, bugArgs } = buildBugExclusionFragment(config.bugIssueTypes);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT
        strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week,
        SUM(CASE WHEN ${isPos} THEN i.${col} ELSE 0 END) AS total_value,
        SUM(CASE WHEN ${isPos} THEN 1 ELSE 0 END)        AS estimated_count,
        SUM(CASE WHEN ${isNull} THEN 1 ELSE 0 END)        AS unestimated_count
      FROM delivered d
      JOIN issues i ON i.key = d.issue_key
      WHERE 1=1 ${excludeSql} ${bugSql} ${cutoffSql} ${endSql}
      GROUP BY week
      ORDER BY week ASC
    `).all(...delivered.args, ...excludeArgs, ...bugArgs, ...cutoffArgs, ...endArgs) as {
      week: string; total_value: number; estimated_count: number; unestimated_count: number;
    }[];

    const divisor = col === "original_estimate_seconds" ? SECONDS_PER_DAY : 1;
    const byWeek = rows.map((r) => ({
      week: r.week,
      estimatedDays: r.total_value / divisor,
      estimatedCount: r.estimated_count,
      unestimatedCount: r.unestimated_count,
    }));

    const total = byWeek.reduce((s, w) => s + w.estimatedDays, 0);
    return {
      byWeek,
      avgPerWeek: byWeek.length > 0 ? total / byWeek.length : 0,
      unit,
      disabled: false,
    };
  },
};

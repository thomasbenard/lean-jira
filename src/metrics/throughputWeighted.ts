import { type Metric, type EstimationMethod } from "./types";
import { SECONDS_PER_DAY } from "./utils";
import type { MetricsContext } from "./context";

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
  | { disabled: false; col: "originalEstimateSeconds" | "storyPoints"; unit: "j-h" | "SP" | "pts" };

function resolveWeightedConfig(method: EstimationMethod): WeightedConfig {
  if (method === "t-shirt" || method === "none") { return { disabled: true }; }
  if (method === "time")         { return { disabled: false, col: "originalEstimateSeconds", unit: "j-h" }; }
  if (method === "story-points") { return { disabled: false, col: "storyPoints", unit: "SP" }; }
  return { disabled: false, col: "storyPoints", unit: "pts" };
}

export const throughputWeightedMetric: Metric<ThroughputWeightedSummary> = {
  name: "throughput-weighted",
  description:
    "Débit pondéré par l'estimation : somme des unités estimées livrées par semaine (1ère transition team-done). Affiche aussi la part non estimée.",

  compute(ctx: MetricsContext): ThroughputWeightedSummary {
    const wcfg = resolveWeightedConfig(ctx.config.estimation.method);

    if (wcfg.disabled) {
      return { byWeek: [], avgPerWeek: 0, unit: "j-h", disabled: true };
    }

    const { col, unit } = wcfg;
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const cutoff = ctx.config.cutoffDate;
    const windowEnd = ctx.config.windowEndDate;

    const aggregator = new Map<string, { totalValue: number; estimatedCount: number; unestimatedCount: number }>();

    for (const [key, doneAt] of ctx.deliveredAt.entries()) {
      if (cutoff && doneAt < cutoff) { continue; }
      if (windowEnd && doneAt > windowEnd) { continue; }
      const issue = ctx.issueByKey.get(key);
      if (!issue) { continue; }
      if (bugSet.has(issue.issueType)) { continue; }

      const rawValue = issue[col];
      // pourquoi : isoWeek aligne sur snapshots/report (remplace strftime('%W') SQL)
      const week = ctx.isoWeek(doneAt);

      let entry = aggregator.get(week);
      if (!entry) {
        entry = { totalValue: 0, estimatedCount: 0, unestimatedCount: 0 };
        aggregator.set(week, entry);
      }

      if (rawValue !== null && rawValue > 0) {
        entry.totalValue += rawValue;
        entry.estimatedCount += 1;
      } else {
        entry.unestimatedCount += 1;
      }
    }

    const divisor = col === "originalEstimateSeconds" ? SECONDS_PER_DAY : 1;
    const byWeek: ThroughputWeightedByWeek[] = Array.from(aggregator.entries())
      .map(([week, e]) => ({
        week,
        estimatedDays: e.totalValue / divisor,
        estimatedCount: e.estimatedCount,
        unestimatedCount: e.unestimatedCount,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    const avgPerWeek = byWeek.length > 0 ? byWeek.reduce((s, r) => s + r.estimatedDays, 0) / byWeek.length : 0;

    return { byWeek, avgPerWeek, unit, disabled: false };
  },
};

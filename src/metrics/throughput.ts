import type { Metric } from "./types";
import type { MetricsContext } from "./context";

export interface ThroughputByWeek {
  week: string;
  count: number;
}

export interface ThroughputSummary {
  byWeek: ThroughputByWeek[];
  avgPerWeek: number;
}

export const throughputMetric: Metric<ThroughputSummary> = {
  name: "throughput",
  description:
    "Issues livrées par semaine. Livraison = 1ère transition vers statut team-done (statusCategory='done' ∪ doneStatuses config).",

  compute(ctx: MetricsContext): ThroughputSummary {
    const cutoff = ctx.config.cutoffDate;
    const windowEnd = ctx.config.windowEndDate;
    const counts = new Map<string, number>();
    for (const doneAt of ctx.deliveredAt.values()) {
      if (cutoff && doneAt < cutoff) { continue; }
      if (windowEnd && doneAt > windowEnd) { continue; }
      // pourquoi : isoWeek (ISO 8601) à la place de strftime('%W') SQL pour aligner
      // le label de semaine avec snapshots/compute.ts qui utilise déjà isoWeek.
      const week = ctx.isoWeek(doneAt);
      counts.set(week, (counts.get(week) ?? 0) + 1);
    }
    const byWeek: ThroughputByWeek[] = Array.from(counts.entries())
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week));
    const total = byWeek.reduce((sum, r) => sum + r.count, 0);
    const avgPerWeek = byWeek.length > 0 ? total / byWeek.length : 0;
    return { byWeek, avgPerWeek };
  },
};

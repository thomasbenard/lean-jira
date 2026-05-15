import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type ThroughputByWeek, type ThroughputSummary } from "./throughput";

export type { ThroughputByWeek as BugThroughputByWeek, ThroughputSummary as BugThroughputSummary };

export const bugThroughputMetric: Metric<ThroughputSummary> = {
  name: "bug-throughput",
  description: "Bugs livrés par semaine (1ère transition team-done). Mesure la charge incidents (vs débit features).",

  compute(ctx: MetricsContext): ThroughputSummary {
    if (ctx.config.bugIssueTypes.length === 0) {
      return { byWeek: [], avgPerWeek: 0 };
    }

    const bugSet = new Set(ctx.config.bugIssueTypes);
    const cutoff = ctx.config.cutoffDate;
    const windowEnd = ctx.config.windowEndDate;
    const counts = new Map<string, number>();

    for (const [issueKey, doneAt] of ctx.deliveredAt.entries()) {
      const issue = ctx.issueByKey.get(issueKey);
      if (!issue) { continue; }
      if (!bugSet.has(issue.issueType)) { continue; }
      if (cutoff && doneAt < cutoff) { continue; }
      if (windowEnd && doneAt > windowEnd) { continue; }
      // pourquoi : isoWeek aligne sur snapshots/report (remplace strftime('%W') SQL)
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

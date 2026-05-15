import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, statsFromDays } from "./utils";

export interface LeadTimeIssue {
  issueKey: string;
  todoAt: string;
  resolvedAt: string; // pourquoi : = done_at (1ère transition team-done), pas Jira resolutiondate
  leadTimeDays: number;
}

export interface LeadTimeSummary extends DurationStats {
  issues: LeadTimeIssue[];
}

export const leadTimeMetric: Metric<LeadTimeSummary> = {
  name: "lead-time",
  description: "Délai entre l'entrée en TODO et la livraison team-done",

  compute(ctx: MetricsContext): LeadTimeSummary {
    const todoSet = new Set(ctx.config.todoStatuses);
    const issues: LeadTimeIssue[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      const list = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      const todoTransition = list.find((t) => todoSet.has(t.toStatus));
      if (!todoTransition) { continue; }
      const todoAt = todoTransition.transitionedAt;
      if (sample.doneAt < todoAt) { continue; }
      issues.push({
        issueKey: sample.issueKey,
        todoAt,
        resolvedAt: sample.doneAt,
        leadTimeDays: ctx.workingDaysBetween(todoAt, sample.doneAt),
      });
    }
    issues.sort((a, b) => a.issueKey.localeCompare(b.issueKey));
    const stats = statsFromDays(
      issues.map((i) => i.leadTimeDays),
      ctx.config.excludeOutliers !== false,
    );
    return { ...stats, issues };
  },
};

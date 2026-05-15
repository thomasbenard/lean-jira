import type { Metric } from "./types";
import type { MetricsContext } from "./context";

export interface WipResult {
  currentWip: number;
  sprintName: string | null;
  issueKeys: string[];
}

export const wipMetric: Metric<WipResult> = {
  name: "wip",
  description: "Travail en cours simultané (sprint actif). Limiter pour réduire le cycle-time (loi de Little).",

  compute(ctx: MetricsContext): WipResult {
    // pourquoi : SQL "ORDER BY start_date DESC LIMIT 1" — préserve via tri startDate DESC
    const activeSprints = ctx.store.sprints.all()
      .filter((s) => s.state === "active")
      .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

    if (activeSprints.length === 0) {
      return { currentWip: 0, sprintName: null, issueKeys: [] };
    }
    const sprint = activeSprints[0];

    const inProgressSet = new Set(ctx.config.inProgressStatuses);
    const issueKeys: string[] = [];
    for (const issue of ctx.issues) {
      if (issue.currentSprintId !== sprint.id) { continue; }
      if (!inProgressSet.has(issue.currentStatus)) { continue; }
      issueKeys.push(issue.key);
    }

    return { currentWip: issueKeys.length, sprintName: sprint.name, issueKeys };
  },
};

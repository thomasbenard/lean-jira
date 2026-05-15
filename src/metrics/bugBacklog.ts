import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { now } from "../clock";

export interface BugBacklogResult {
  openCount: number;
  netFlow: number;
  created: number;
  closed: number;
}

export const bugBacklogMetric: Metric<BugBacklogResult> = {
  name: "bug-backlog",
  description:
    "Bugs ouverts (point-in-time) et flux net hebdo. Détecte si le backlog grossit.",

  compute(ctx: MetricsContext): BugBacklogResult {
    const { config } = ctx;
    const bugTypes = new Set(config.bugIssueTypes);
    if (bugTypes.size === 0) {
      return { openCount: 0, netFlow: 0, created: 0, closed: 0 };
    }
    const endDate = config.windowEndDate ?? now().toISOString().slice(0, 10);
    const startDate = config.cutoffDate ?? endDate;
    const doneSet = new Set(config.doneStatuses);

    let openCount = 0;
    for (const issue of ctx.issues) {
      if (!bugTypes.has(issue.issueType)) { continue; }
      if (issue.createdAt.slice(0, 10) > endDate) { continue; }

      if (doneSet.size === 0) {
        openCount += 1;
        continue;
      }

      // pourquoi : transitionsByIssue est trié par (transitionedAt, id) ;
      // le DERNIER élément dont la date <= endDate est l'état déterministe
      // à la fin de la fenêtre (équivalent SQL MAX(transitioned_at) sans
      // l'ambiguïté en cas d'ex æquo).
      const tList = ctx.transitionsByIssue.get(issue.key) ?? [];
      let lastBeforeEnd: string | null = null;
      for (const t of tList) {
        if (t.transitionedAt.slice(0, 10) <= endDate) {
          lastBeforeEnd = t.toStatus;
        } else {
          break;
        }
      }
      if (lastBeforeEnd === null || !doneSet.has(lastBeforeEnd)) {
        openCount += 1;
      }
    }

    let created = 0;
    for (const issue of ctx.issues) {
      if (!bugTypes.has(issue.issueType)) { continue; }
      const d = issue.createdAt.slice(0, 10);
      if (d >= startDate && d <= endDate) {
        created += 1;
      }
    }

    let closed = 0;
    if (doneSet.size > 0) {
      for (const [key, doneAt] of ctx.deliveredAt) {
        const issue = ctx.issueByKey.get(key);
        if (!issue) { continue; }
        if (!bugTypes.has(issue.issueType)) { continue; }
        const d = doneAt.slice(0, 10);
        if (d >= startDate && d <= endDate) {
          closed += 1;
        }
      }
    }

    return { openCount, netFlow: closed - created, created, closed };
  },
};

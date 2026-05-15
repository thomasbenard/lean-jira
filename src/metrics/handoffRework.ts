import { type Metric } from "./types";
import type { MetricsContext } from "./context";

export type ReworkType = "qaToDev" | "poToQa" | "poDev";

export interface ReworkIssue {
  issueKey: string;
  reworkCount: number;
  reworkTypes: ReworkType[];
}

export interface HandoffReworkResult {
  count: number;
  reworkRatio: number;
  avgReworks: number;
  byReworkType: Record<ReworkType, number>;
  issues: ReworkIssue[];
}

// Ordre naturel des rôles : index plus petit = amont. Rework = transition vers index plus petit.
const ROLE_ORDER: Record<string, number> = { dev: 0, qa: 1, po: 2 };

function reworkKey(from: string, to: string): ReworkType | null {
  if (from === "qa" && to === "dev") {return "qaToDev";}
  if (from === "po" && to === "qa") {return "poToQa";}
  if (from === "po" && to === "dev") {return "poDev";}
  return null;
}

export const handoffReworkMetric: Metric<HandoffReworkResult> = {
  name: "handoff-rework",
  description:
    "Taux de rework entre rôles (qa→dev, po→qa, po→dev) sur tickets livrés. Qualité d'entrée par étape.",

  compute(ctx: MetricsContext): HandoffReworkResult {
    const config = ctx.config;
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa: new Set(config.qaStatuses ?? []),
      po: new Set(config.poStatuses ?? []),
    };

    const getRole = (status: string): string | null => {
      if (roles.dev.has(status)) {return "dev";}
      if (roles.qa.has(status)) {return "qa";}
      if (roles.po.has(status)) {return "po";}
      return null;
    };

    const issuesWithRework: ReworkIssue[] = [];
    const byReworkType: Record<ReworkType, number> = { qaToDev: 0, poToQa: 0, poDev: 0 };
    let totalReworks = 0;

    for (const sample of ctx.cycleTimePopulation) {
      const allTrans = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      // pourquoi : SQL legacy filtrait tr.transitioned_at >= started_at AND <= done_at
      const transitions = allTrans.filter(
        (t) => t.transitionedAt >= sample.startedAt && t.transitionedAt <= sample.doneAt,
      );

      const reworks: ReworkType[] = [];
      let prevRole: string | null = null;

      for (const t of transitions) {
        const curRole = getRole(t.toStatus);
        if (curRole !== null && curRole !== prevRole) {
          if (prevRole !== null) {
            const prevIdx = ROLE_ORDER[prevRole];
            const curIdx = ROLE_ORDER[curRole];
            if (curIdx < prevIdx) {
              const k = reworkKey(prevRole, curRole);
              if (k) {
                reworks.push(k);
                byReworkType[k]++;
              }
            }
          }
          prevRole = curRole;
        }
        // prevRole conservé à travers les statuts sans rôle : qa→[none]→dev reste un rework.
      }

      totalReworks += reworks.length;
      if (reworks.length > 0) {
        issuesWithRework.push({ issueKey: sample.issueKey, reworkCount: reworks.length, reworkTypes: reworks });
      }
    }

    const count = ctx.cycleTimePopulation.length;
    return {
      count,
      reworkRatio: count > 0 ? issuesWithRework.length / count : 0,
      avgReworks: count > 0 ? totalReworks / count : 0,
      byReworkType,
      issues: issuesWithRework.sort((a, b) => b.reworkCount - a.reworkCount),
    };
  },
};

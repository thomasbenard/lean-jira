import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { fetchDeliveredTransitions, groupByIssue } from "./utils";

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
  if (from === "qa" && to === "dev") return "qaToDev";
  if (from === "po" && to === "qa") return "poToQa";
  if (from === "po" && to === "dev") return "poDev";
  return null;
}

export const handoffReworkMetric: Metric<HandoffReworkResult> = {
  name: "handoff-rework",
  description:
    "Taux de rework entre rôles (qa→dev, po→qa, po→dev) sur tickets livrés. Qualité d'entrée par étape.",

  compute(db: Database.Database, config: MetricConfig): HandoffReworkResult {
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa: new Set(config.qaStatuses ?? []),
      po: new Set(config.poStatuses ?? []),
    };

    const getRole = (status: string): string | null => {
      if (roles.dev.has(status)) return "dev";
      if (roles.qa.has(status)) return "qa";
      if (roles.po.has(status)) return "po";
      return null;
    };

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);

    const issuesWithRework: ReworkIssue[] = [];
    const byReworkType: Record<ReworkType, number> = { qaToDev: 0, poToQa: 0, poDev: 0 };
    let totalReworks = 0;

    for (const [key, transitions] of byIssue) {
      const reworks: ReworkType[] = [];
      let prevRole: string | null = null;

      for (const t of transitions) {
        const curRole = getRole(t.to_status);
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
        issuesWithRework.push({ issueKey: key, reworkCount: reworks.length, reworkTypes: reworks });
      }
    }

    const count = byIssue.size;
    return {
      count,
      reworkRatio: count > 0 ? issuesWithRework.length / count : 0,
      avgReworks: count > 0 ? totalReworks / count : 0,
      byReworkType,
      issues: issuesWithRework.sort((a, b) => b.reworkCount - a.reworkCount),
    };
  },
};

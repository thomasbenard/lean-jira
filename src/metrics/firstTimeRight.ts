import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { fetchDeliveredTransitions, groupByIssue } from "./utils";

export interface FtrRoleStats {
  eligible: number;       // tickets ayant ≥ 1 passage dans ce rôle
  firstTimeRight: number; // tickets avec exactement 1 passage
  ftrRate: number;        // firstTimeRight / eligible, 0 si eligible=0 (pas NaN)
  avgPasses: number;      // moyenne de passages par ticket éligible
}

export interface FirstTimeRightResult {
  count: number;          // tickets analysés (population cycle-time)
  ftrByRole: {
    dev: FtrRoleStats;
    qa: FtrRoleStats;
    po: FtrRoleStats;
  };
}

type RoleKey = "dev" | "qa" | "po";

export const firstTimeRightMetric: Metric<FirstTimeRightResult> = {
  name: "first-time-right",
  description:
    "% tickets traversant chaque rôle en un seul passage. FTR QA = qualité d'entrée dev.",

  compute(db: Database.Database, config: MetricConfig): FirstTimeRightResult {
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa: new Set(config.qaStatuses ?? []),
      po: new Set(config.poStatuses ?? []),
    };

    const getRole = (status: string): RoleKey | null => {
      if (roles.dev.has(status)) return "dev";
      if (roles.qa.has(status)) return "qa";
      if (roles.po.has(status)) return "po";
      return null;
    };

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);

    const acc: Record<RoleKey, { eligible: number; ftr: number; totalPasses: number }> = {
      dev: { eligible: 0, ftr: 0, totalPasses: 0 },
      qa: { eligible: 0, ftr: 0, totalPasses: 0 },
      po: { eligible: 0, ftr: 0, totalPasses: 0 },
    };

    for (const transitions of byIssue.values()) {
      const passes: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
      let prevRole: RoleKey | null = null;

      for (const t of transitions) {
        const cur = getRole(t.to_status);
        if (cur !== null) {
          if (cur !== prevRole) {
            passes[cur]++;
            prevRole = cur;
          }
        } else {
          // Un statut sans rôle coupe le bloc : deux blocs du même rôle séparés
          // par un statut none sont comptés comme deux passages distincts.
          prevRole = null;
        }
      }

      for (const role of ["dev", "qa", "po"] as RoleKey[]) {
        if (passes[role] > 0) {
          acc[role].eligible++;
          acc[role].totalPasses += passes[role];
          if (passes[role] === 1) acc[role].ftr++;
        }
      }
    }

    const toStats = (a: { eligible: number; ftr: number; totalPasses: number }): FtrRoleStats => ({
      eligible: a.eligible,
      firstTimeRight: a.ftr,
      ftrRate: a.eligible > 0 ? a.ftr / a.eligible : 0,
      avgPasses: a.eligible > 0 ? a.totalPasses / a.eligible : 0,
    });

    return {
      count: byIssue.size,
      ftrByRole: { dev: toStats(acc.dev), qa: toStats(acc.qa), po: toStats(acc.po) },
    };
  },
};

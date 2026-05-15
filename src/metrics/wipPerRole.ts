import type { Metric } from "./types";
import type { MetricsContext } from "./context";

export interface WipRoleSlice {
  count: number;
  issueKeys: string[];
}

export interface WipPerRoleResult {
  byRole: {
    dev: WipRoleSlice;
    qa: WipRoleSlice;
    po: WipRoleSlice;
  };
}

export const wipPerRoleMetric: Metric<WipPerRoleResult> = {
  name: "wip-per-role",
  description:
    "WIP actuel ventilé par rôle (dev/qa/po). Détecte la saturation par étape du process.",

  compute(ctx: MetricsContext): WipPerRoleResult {
    const roles = {
      dev: ctx.config.devStatuses ?? [],
      qa: ctx.config.qaStatuses ?? [],
      po: ctx.config.poStatuses ?? [],
    };

    const allEmpty = Object.values(roles).every((r) => r.length === 0);
    if (allEmpty) {
      console.warn(
        "  ⚠ wip-per-role : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes",
      );
      return emptyResult();
    }

    const byRole: WipPerRoleResult["byRole"] = { dev: empty(), qa: empty(), po: empty() };

    for (const role of ["dev", "qa", "po"] as const) {
      const statuses = roles[role];
      if (statuses.length === 0) {continue;}
      const inSet = new Set(statuses);
      const keys = ctx.issues
        .filter((issue) => inSet.has(issue.currentStatus))
        .map((issue) => issue.key)
        .sort();
      byRole[role] = { count: keys.length, issueKeys: keys };
    }

    return { byRole };
  },
};

function empty(): WipRoleSlice {
  return { count: 0, issueKeys: [] };
}

function emptyResult(): WipPerRoleResult {
  return { byRole: { dev: empty(), qa: empty(), po: empty() } };
}

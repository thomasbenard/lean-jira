import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildExcludeIssueTypesFragment, placeholders } from "./utils";

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

  compute(db: Database.Database, config: MetricConfig): WipPerRoleResult {
    const roles = {
      dev: config.devStatuses ?? [],
      qa: config.qaStatuses ?? [],
      po: config.poStatuses ?? [],
    };

    const allEmpty = Object.values(roles).every((r) => r.length === 0);
    if (allEmpty) {
      console.warn(
        "  ⚠ wip-per-role : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes",
      );
      return emptyResult();
    }

    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes, "");

    const byRole: WipPerRoleResult["byRole"] = { dev: empty(), qa: empty(), po: empty() };

    for (const role of ["dev", "qa", "po"] as const) {
      const statuses = roles[role];
      if (statuses.length === 0) {continue;}
      const ph = placeholders(statuses);
      const rows = db
        .prepare(
          `SELECT key FROM issues WHERE current_status IN (${ph}) ${excludeSql}`,
        )
        .all(...statuses, ...excludeArgs) as { key: string }[];
      byRole[role] = { count: rows.length, issueKeys: rows.map((r) => r.key) };
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

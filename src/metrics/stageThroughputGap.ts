import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildExcludeIssueTypesFragment, isoWeek } from "./utils";

export interface StageWeekRow {
  week: string;
  devIn: number;
  devOut: number;
  devNet: number;
  qaIn: number;
  qaOut: number;
  qaNet: number;
  poIn: number;
  poOut: number;
  poNet: number;
}

export interface StageThroughputGapResult {
  byWeek: StageWeekRow[];
  avgNetByRole: { dev: number; qa: number; po: number };
}

type RoleKey = "dev" | "qa" | "po";

export const stageThroughputGapMetric: Metric<StageThroughputGapResult> = {
  name: "stage-throughput-gap",
  description:
    "Entrées/sorties par rôle par semaine. Net positif persistant = bottleneck. Prédictif.",

  compute(db: Database.Database, config: MetricConfig): StageThroughputGapResult {
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa: new Set(config.qaStatuses ?? []),
      po: new Set(config.poStatuses ?? []),
    };

    const allEmpty = [roles.dev, roles.qa, roles.po].every((s) => s.size === 0);
    if (allEmpty) {
      console.warn("  ⚠ stage-throughput-gap : aucun rôle configuré dans board.yaml");
      return { byWeek: [], avgNetByRole: { dev: 0, qa: 0, po: 0 } };
    }

    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);
    const cutoffSql = config.cutoffDate ? "AND t.transitioned_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND t.transitioned_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    const rows = db.prepare(`
      SELECT t.issue_key, t.to_status, t.transitioned_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE 1=1 ${excludeSql} ${cutoffSql} ${endSql}
      ORDER BY t.issue_key ASC, t.transitioned_at ASC, t.id ASC
    `).all(...excludeArgs, ...cutoffArgs, ...endArgs) as {
      issue_key: string;
      to_status: string;
      transitioned_at: string;
    }[];

    const byIssue = new Map<string, { to_status: string; transitioned_at: string }[]>();
    for (const r of rows) {
      let list = byIssue.get(r.issue_key);
      if (!list) {
        list = [];
        byIssue.set(r.issue_key, list);
      }
      list.push({ to_status: r.to_status, transitioned_at: r.transitioned_at });
    }

    const weekMap = new Map<string, Record<`${RoleKey}In` | `${RoleKey}Out`, number>>();

    const getWeekEntry = (week: string) => {
      let e = weekMap.get(week);
      if (!e) {
        e = { devIn: 0, devOut: 0, qaIn: 0, qaOut: 0, poIn: 0, poOut: 0 };
        weekMap.set(week, e);
      }
      return e;
    };

    const getRole = (status: string): RoleKey | null => {
      if (roles.dev.has(status)) return "dev";
      if (roles.qa.has(status)) return "qa";
      if (roles.po.has(status)) return "po";
      return null;
    };

    for (const transitions of byIssue.values()) {
      let prevRole: RoleKey | null = null;
      for (const t of transitions) {
        const curRole = getRole(t.to_status);
        if (curRole !== prevRole) {
          const week = isoWeek(t.transitioned_at);
          if (prevRole !== null) {
            getWeekEntry(week)[`${prevRole}Out`]++;
          }
          if (curRole !== null) {
            getWeekEntry(week)[`${curRole}In`]++;
          }
          prevRole = curRole;
        }
      }
    }

    const byWeek: StageWeekRow[] = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, e]) => ({
        week,
        devIn: e.devIn,
        devOut: e.devOut,
        devNet: e.devIn - e.devOut,
        qaIn: e.qaIn,
        qaOut: e.qaOut,
        qaNet: e.qaIn - e.qaOut,
        poIn: e.poIn,
        poOut: e.poOut,
        poNet: e.poIn - e.poOut,
      }));

    const n = byWeek.length;
    let sumDev = 0, sumQa = 0, sumPo = 0;
    for (const w of byWeek) { sumDev += w.devNet; sumQa += w.qaNet; sumPo += w.poNet; }
    const avgNetByRole = n === 0
      ? { dev: 0, qa: 0, po: 0 }
      : { dev: sumDev / n, qa: sumQa / n, po: sumPo / n };

    return { byWeek, avgNetByRole };
  },
};

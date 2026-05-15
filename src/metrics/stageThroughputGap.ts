import { type Metric } from "./types";
import type { MetricsContext } from "./context";

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

  compute(ctx: MetricsContext): StageThroughputGapResult {
    const config = ctx.config;
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

    const cutoff = config.cutoffDate;
    const windowEnd = config.windowEndDate;

    const weekMap = new Map<string, Record<`${RoleKey}In` | `${RoleKey}Out`, number>>();

    const getWeekEntry = (week: string): Record<`${RoleKey}In` | `${RoleKey}Out`, number> => {
      let e = weekMap.get(week);
      if (!e) {
        e = { devIn: 0, devOut: 0, qaIn: 0, qaOut: 0, poIn: 0, poOut: 0 };
        weekMap.set(week, e);
      }
      return e;
    };

    const getRole = (status: string): RoleKey | null => {
      if (roles.dev.has(status)) {return "dev";}
      if (roles.qa.has(status)) {return "qa";}
      if (roles.po.has(status)) {return "po";}
      return null;
    };

    // pourquoi : ctx.transitionsByIssue est déjà filtré par excludeIssueTypes en amont
    // et trié par (transitionedAt, id) — équivalent du SELECT legacy avec ORDER BY
    for (const transitions of ctx.transitionsByIssue.values()) {
      let prevRole: RoleKey | null = null;
      for (const t of transitions) {
        // Filtres appliqués au niveau transition (≠ filtres au niveau issue) :
        // SQL legacy utilise >= cutoff / <= windowEnd en compare lexicographique
        // (équivalent string compare JS sur ISO timestamps).
        if (cutoff && t.transitionedAt < cutoff) { continue; }
        if (windowEnd && t.transitionedAt > windowEnd) { continue; }

        const curRole = getRole(t.toStatus);
        if (curRole !== prevRole) {
          const week = ctx.isoWeek(t.transitionedAt);
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

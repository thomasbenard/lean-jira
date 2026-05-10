import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import {
  fetchDeliveredTransitions,
  groupByIssue,
  computeRoleDays,
  toRoleStatuses,
  statsFromDays,
  isoWeek,
  buildExcludeIssueTypesFragment,
  type RoleStatuses,
} from "./utils";

export type RoleKey = "dev" | "qa" | "po";
export type BottleneckSignal = "accumulation" | "stage_time" | "rework" | "ftr" | "combined";

export interface RoleSignals {
  stageTimeMedianDays: number;
  avgNetFlow: number;
  reworkInboundRate: number;
  ftrPenalty: number;
}

export interface RoleBottleneckScore {
  score: number;
  rank: number;
  dominantSignal: BottleneckSignal;
  signals: RoleSignals;
}

export interface BottleneckAnalysisResult {
  count: number;
  primaryBottleneck: RoleKey | null;
  recommendation: string;
  byRole: Record<RoleKey, RoleBottleneckScore>;
}

// Assignement de rangs normalisés 0–1 par ordre croissant. Ex-æquo → même rang.
// Normalise sur le nombre de valeurs distinctes, pas sur le nombre d'éléments.
export function rankNormalize(values: number[]): number[] {
  if (values.length === 1) {return [0];}
  const uniqueSorted = [...new Set(values)].sort((a, b) => a - b);
  const n = uniqueSorted.length;
  if (n === 1) {return values.map(() => 0);}
  return values.map((v) => uniqueSorted.indexOf(v) / (n - 1));
}

// Identifie le signal dominant. Si l'écart entre le plus haut et le deuxième < 0.1 → "combined".
// Priorité TOC en cas d'égalité : accumulation > stage_time > rework > ftr.
export function computeDominantSignal(ranks: {
  stageTime: number;
  netFlow: number;
  rework: number;
  ftr: number;
}): BottleneckSignal {
  const candidates: { signal: BottleneckSignal; rank: number; priority: number }[] = [
    { signal: "accumulation", rank: ranks.netFlow,   priority: 0 },
    { signal: "stage_time",   rank: ranks.stageTime, priority: 1 },
    { signal: "rework",       rank: ranks.rework,    priority: 2 },
    { signal: "ftr",          rank: ranks.ftr,       priority: 3 },
  ];
  candidates.sort((a, b) => b.rank - a.rank || a.priority - b.priority);
  const diff = candidates[0].rank - candidates[1].rank;
  // Égalité exacte → priorité TOC (déjà triée). Quasi-égalité (0 < diff < 0.1) → combined.
  if (diff > 0 && diff < 0.1) {return "combined";}
  return candidates[0].signal;
}

const RECOMMENDATIONS: Record<BottleneckSignal, (role: RoleKey) => string> = {
  accumulation: (r) => `Réduire les entrées en ${r} ou augmenter la capacité disponible à ce stage.`,
  stage_time:   (r) => `Décomposer les tâches avant ${r} pour réduire le temps de passage unitaire.`,
  rework:       (r) => `Améliorer les critères d'entrée en ${r} (Definition of Ready) pour éviter les retours.`,
  ftr:          (r) => `Renforcer les critères de sortie de ${r} (Definition of Done) pour éviter les rejets.`,
  combined:     (r) => `Plusieurs signaux convergent sur ${r} — analyser la charge et la qualité simultanément.`,
};

function emptyScore(): RoleBottleneckScore {
  return {
    score: 0,
    rank: 3,
    dominantSignal: "combined",
    signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 },
  };
}

function emptyResult(): BottleneckAnalysisResult {
  return {
    count: 0,
    primaryBottleneck: null,
    recommendation: "",
    byRole: { dev: emptyScore(), qa: emptyScore(), po: emptyScore() },
  };
}

function computeAvgNetFlow(
  db: Database.Database,
  config: MetricConfig,
  getRole: (s: string) => RoleKey | null,
): Record<RoleKey, number> {
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
    if (!list) {list = []; byIssue.set(r.issue_key, list);}
    list.push({ to_status: r.to_status, transitioned_at: r.transitioned_at });
  }

  const weekMap = new Map<string, Record<`${RoleKey}In` | `${RoleKey}Out`, number>>();
  const getWeekEntry = (week: string): Record<`${RoleKey}In` | `${RoleKey}Out`, number> => {
    let e = weekMap.get(week);
    if (!e) {e = { devIn: 0, devOut: 0, qaIn: 0, qaOut: 0, poIn: 0, poOut: 0 }; weekMap.set(week, e);}
    return e;
  };

  for (const transitions of byIssue.values()) {
    let prevRole: RoleKey | null = null;
    for (const t of transitions) {
      const cur = getRole(t.to_status);
      if (cur !== prevRole) {
        const week = isoWeek(t.transitioned_at);
        if (prevRole !== null) {getWeekEntry(week)[`${prevRole}Out`]++;}
        if (cur !== null) {getWeekEntry(week)[`${cur}In`]++;}
        prevRole = cur;
      }
    }
  }

  const n = weekMap.size;
  if (n === 0) {return { dev: 0, qa: 0, po: 0 };}
  let sumDev = 0, sumQa = 0, sumPo = 0;
  for (const e of weekMap.values()) {
    sumDev += e.devIn - e.devOut;
    sumQa += e.qaIn - e.qaOut;
    sumPo += e.poIn - e.poOut;
  }
  return { dev: sumDev / n, qa: sumQa / n, po: sumPo / n };
}

const ROLE_ORDER: Record<RoleKey, number> = { dev: 0, qa: 1, po: 2 };
const ALL_ROLES: RoleKey[] = ["dev", "qa", "po"];

export const bottleneckAnalysisMetric: Metric<BottleneckAnalysisResult> = {
  name: "bottleneck-analysis",
  description:
    "Score composite 0–1 de bottleneck par rôle (dev/qa/po). Identifie le stage prioritaire à améliorer selon Theory of Constraints.",

  compute(db: Database.Database, config: MetricConfig): BottleneckAnalysisResult {
    const roles: RoleStatuses = toRoleStatuses(config);
    const allEmpty =
      roles.devStatuses.length === 0 &&
      roles.qaStatuses.length === 0 &&
      roles.poStatuses.length === 0;

    if (allEmpty) {
      console.warn(
        "  ⚠ bottleneck-analysis : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes",
      );
      return emptyResult();
    }

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);
    const count = byIssue.size;
    if (count === 0) {return emptyResult();}

    const roleSets = {
      dev: new Set(roles.devStatuses),
      qa: new Set(roles.qaStatuses),
      po: new Set(roles.poStatuses),
    };

    const getRole = (s: string): RoleKey | null => {
      if (roleSets.dev.has(s)) {return "dev";}
      if (roleSets.qa.has(s)) {return "qa";}
      if (roleSets.po.has(s)) {return "po";}
      return null;
    };

    const stageTimeDays: Record<RoleKey, number[]> = { dev: [], qa: [], po: [] };
    const reworkInbound: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
    const ftrAcc: Record<RoleKey, { eligible: number; ftr: number }> = {
      dev: { eligible: 0, ftr: 0 },
      qa: { eligible: 0, ftr: 0 },
      po: { eligible: 0, ftr: 0 },
    };

    for (const [, transitions] of byIssue) {
      const done_at = transitions[0].done_at;
      const { devDays, qaDays, poDays } = computeRoleDays(transitions, done_at, roles);
      stageTimeDays.dev.push(devDays);
      stageTimeDays.qa.push(qaDays);
      stageTimeDays.po.push(poDays);

      const inboundThisIssue = new Set<RoleKey>();
      let prevRoleRework: RoleKey | null = null;
      const passes: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
      let prevRoleFtr: RoleKey | null = null;

      for (const t of transitions) {
        const cur = getRole(t.to_status);

        // rework: prevRole conservé à travers statuts sans rôle (cohérent avec handoff-rework)
        if (cur !== null && cur !== prevRoleRework) {
          if (prevRoleRework !== null && ROLE_ORDER[cur] < ROLE_ORDER[prevRoleRework]) {
            inboundThisIssue.add(cur);
          }
          prevRoleRework = cur;
        }

        if (cur !== null) {
          if (cur !== prevRoleFtr) {passes[cur]++; prevRoleFtr = cur;}
        } else {
          prevRoleFtr = null;
        }
      }

      for (const role of inboundThisIssue) {reworkInbound[role]++;}
      for (const role of ALL_ROLES) {
        if (passes[role] > 0) {
          ftrAcc[role].eligible++;
          if (passes[role] === 1) {ftrAcc[role].ftr++;}
        }
      }
    }

    const stageTimeMedian: Record<RoleKey, number> = {
      dev: statsFromDays(stageTimeDays.dev, false).medianDays,
      qa: statsFromDays(stageTimeDays.qa, false).medianDays,
      po: statsFromDays(stageTimeDays.po, false).medianDays,
    };

    const reworkInboundRate: Record<RoleKey, number> = {
      dev: reworkInbound.dev / count,
      qa: reworkInbound.qa / count,
      po: 0, // po est le stage final — rien ne lui revient en retour
    };

    const ftrPenalty: Record<RoleKey, number> = {
      dev: ftrAcc.dev.eligible > 0 ? 1 - ftrAcc.dev.ftr / ftrAcc.dev.eligible : 0,
      qa: ftrAcc.qa.eligible > 0 ? 1 - ftrAcc.qa.ftr / ftrAcc.qa.eligible : 0,
      po: ftrAcc.po.eligible > 0 ? 1 - ftrAcc.po.ftr / ftrAcc.po.eligible : 0,
    };

    // avgNetFlow couvre toutes les transitions (WIP inclus) — population plus large que les livrées intentionnellement
    const avgNetFlow = computeAvgNetFlow(db, config, getRole);

    const rankStageTime = rankNormalize(ALL_ROLES.map((r) => stageTimeMedian[r]));
    const rankNetFlow   = rankNormalize(ALL_ROLES.map((r) => avgNetFlow[r]));
    const rankRework    = rankNormalize(ALL_ROLES.map((r) => reworkInboundRate[r]));
    const rankFtr       = rankNormalize(ALL_ROLES.map((r) => ftrPenalty[r]));

    const byRole: Record<RoleKey, RoleBottleneckScore> = {} as Record<RoleKey, RoleBottleneckScore>;
    for (let i = 0; i < ALL_ROLES.length; i++) {
      const role = ALL_ROLES[i];
      const score = (rankStageTime[i] + rankNetFlow[i] + rankRework[i] + rankFtr[i]) / 4;
      byRole[role] = {
        score,
        rank: 0,
        dominantSignal: computeDominantSignal({
          stageTime: rankStageTime[i],
          netFlow: rankNetFlow[i],
          rework: rankRework[i],
          ftr: rankFtr[i],
        }),
        signals: {
          stageTimeMedianDays: stageTimeMedian[role],
          avgNetFlow: avgNetFlow[role],
          reworkInboundRate: reworkInboundRate[role],
          ftrPenalty: ftrPenalty[role],
        },
      };
    }

    // Ranking : score décroissant, tiebreak alphabétique stable (dev < po < qa)
    const sorted = [...ALL_ROLES].sort((a, b) => {
      const diff = byRole[b].score - byRole[a].score;
      if (diff !== 0) {return diff;}
      return a.localeCompare(b);
    });
    sorted.forEach((role, i) => {byRole[role].rank = i + 1;});

    const primaryBottleneck = sorted[0];
    const recommendation = RECOMMENDATIONS[byRole[primaryBottleneck].dominantSignal](primaryBottleneck);

    return { count, primaryBottleneck, recommendation, byRole };
  },
};

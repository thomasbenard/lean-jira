import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import {
  fetchDeliveredTransitions,
  groupByIssue,
  computeRoleDays,
  toRoleStatuses,
  statsFromDays,
  removeUpperOutliers,
  workingDaysBetween,
  type DurationStats,
  type RoleStatuses,
} from "./utils";

export interface StageTimeSummary {
  count: number;
  excludedOutliers: number;
  byRole: {
    dev: DurationStats;
    qa: DurationStats;
    po: DurationStats;
  };
  avgShareByRole: {
    dev: number;
    qa: number;
    po: number;
  };
}

function emptyResult(): StageTimeSummary {
  const empty: DurationStats = { count: 0, excludedOutliers: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0 };
  return {
    count: 0,
    excludedOutliers: 0,
    byRole: { dev: empty, qa: empty, po: empty },
    avgShareByRole: { dev: 0, qa: 0, po: 0 },
  };
}

export const stageTimeBreakdownMetric: Metric<StageTimeSummary> = {
  name: "stage-time-breakdown",
  description:
    "Temps médian passé dans chaque rôle (dev/qa/po) sur la population cycle-time. Révèle où le lead time est consommé.",

  compute(db: Database.Database, config: MetricConfig): StageTimeSummary {
    const roles: RoleStatuses = toRoleStatuses(config);
    const allEmpty =
      roles.devStatuses.length === 0 &&
      roles.qaStatuses.length === 0 &&
      roles.poStatuses.length === 0;

    if (allEmpty) {
      console.warn(
        "  ⚠ stage-time-breakdown : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes",
      );
      return emptyResult();
    }

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);

    const rawIssues: Array<{
      key: string;
      done_at: string;
      devDays: number;
      qaDays: number;
      poDays: number;
      cycleDays: number;
    }> = [];

    for (const [key, transitions] of byIssue) {
      const done_at = transitions[0].done_at;
      const started_at = transitions[0].started_at;
      const { devDays, qaDays, poDays } = computeRoleDays(transitions, done_at, roles);
      const cycleDays = workingDaysBetween(started_at, done_at);
      rawIssues.push({ key, done_at, devDays, qaDays, poDays, cycleDays });
    }

    let kept = rawIssues;
    let excluded = 0;
    if (config.excludeOutliers !== false && rawIssues.length >= 4) {
      const totals = rawIssues.map((i) => i.cycleDays);
      const { kept: keptTotals } = removeUpperOutliers(totals);
      const upper = keptTotals.length > 0 ? keptTotals[keptTotals.length - 1] : Infinity;
      kept = rawIssues.filter((i) => i.cycleDays <= upper);
      excluded = rawIssues.length - kept.length;
    }

    const devArr = kept.map((i) => i.devDays);
    const qaArr = kept.map((i) => i.qaDays);
    const poArr = kept.map((i) => i.poDays);

    let sumDev = 0;
    let sumQa = 0;
    let sumPo = 0;
    let shareCount = 0;
    for (const i of kept) {
      const total = i.devDays + i.qaDays + i.poDays;
      if (total > 0) {
        sumDev += i.devDays / total;
        sumQa += i.qaDays / total;
        sumPo += i.poDays / total;
        shareCount++;
      }
    }
    const avgShareByRole =
      shareCount > 0
        ? { dev: sumDev / shareCount, qa: sumQa / shareCount, po: sumPo / shareCount }
        : { dev: 0, qa: 0, po: 0 };

    return {
      count: kept.length,
      excludedOutliers: excluded,
      byRole: {
        // false = pas de double-filtrage outliers : déjà filtré sur cycleDays au niveau issue ci-dessus.
        dev: statsFromDays(devArr, false),
        qa: statsFromDays(qaArr, false),
        po: statsFromDays(poArr, false),
      },
      avgShareByRole,
    };
  },
};

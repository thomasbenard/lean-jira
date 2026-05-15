import { type Metric } from "./types";
import type { MetricsContext } from "./context";
import {
  toRoleStatuses,
  statsFromDays,
  removeUpperOutliers,
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

  compute(ctx: MetricsContext): StageTimeSummary {
    const roles: RoleStatuses = toRoleStatuses(ctx.config);
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

    const devSet = new Set(roles.devStatuses);
    const qaSet = new Set(roles.qaStatuses);
    const poSet = new Set(roles.poStatuses);

    const rawIssues: {
      key: string;
      done_at: string;
      devDays: number;
      qaDays: number;
      poDays: number;
      cycleDays: number;
    }[] = [];

    for (const sample of ctx.cycleTimePopulation) {
      // pourquoi : filtre des anomalies (done_at < started_at) — équivalent du JOIN vide en SQL legacy
      if (sample.doneAt < sample.startedAt) { continue; }
      const allTrans = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      // pourquoi : SQL legacy filtrait tr.transitioned_at >= started_at AND <= done_at
      const trans = allTrans.filter(
        (t) => t.transitionedAt >= sample.startedAt && t.transitionedAt <= sample.doneAt,
      );

      let devDays = 0;
      let qaDays = 0;
      let poDays = 0;
      for (let i = 0; i < trans.length; i++) {
        const start = trans[i].transitionedAt;
        const end = i + 1 < trans.length ? trans[i + 1].transitionedAt : sample.doneAt;
        if (new Date(end).getTime() <= new Date(start).getTime()) { continue; }
        const days = ctx.workingDaysBetween(start, end);
        const status = trans[i].toStatus;
        if (devSet.has(status)) { devDays += days; }
        else if (qaSet.has(status)) { qaDays += days; }
        else if (poSet.has(status)) { poDays += days; }
      }

      const cycleDays = ctx.workingDaysBetween(sample.startedAt, sample.doneAt);
      rawIssues.push({ key: sample.issueKey, done_at: sample.doneAt, devDays, qaDays, poDays, cycleDays });
    }

    let kept = rawIssues;
    let excluded = 0;
    if (ctx.config.excludeOutliers !== false && rawIssues.length >= 4) {
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

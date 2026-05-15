import { type Metric } from "./types";
import type { MetricsContext } from "./context";
import { percentile, removeUpperOutliers } from "./utils";

export interface FlowEfficiencyIssue {
  issueKey: string;
  startedAt: string;
  resolvedAt: string;
  activeDays: number;
  queueDays: number;
  totalDays: number;
  flowEfficiency: number; // active / (active + queue), 0..1
}

export interface FlowEfficiencySummary {
  count: number;
  excludedOutliers: number;
  // Aggregate = sum(active) / (sum(active)+sum(queue)). Pondéré par durée totale,
  // plus représentatif que la moyenne des ratios par issue (qui sur-pondère
  // les petits tickets dont une heure de queue domine le ratio).
  aggregateFlowEfficiency: number;
  medianFlowEfficiency: number;
  p15FlowEfficiency: number;
  totalActiveDays: number;
  totalQueueDays: number;
  issues: FlowEfficiencyIssue[];
  unit: string;
}

export const flowEfficiencyMetric: Metric<FlowEfficiencySummary> = {
  name: "flow-efficiency",
  description:
    "Ratio temps actif / (actif + queue) sur la phase cycle-time. Typique 5-15% : optimiser la file d'attente bat optimiser le dev.",

  compute(ctx: MetricsContext): FlowEfficiencySummary {
    const active = ctx.config.activeStatuses ?? [];
    const queue = ctx.config.queueStatuses ?? [];
    if (active.length === 0) {return emptyResult();}
    const activeSet = new Set(active);
    const queueSet = new Set(queue);

    const out: FlowEfficiencyIssue[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      const allTrans = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      // pourquoi : SQL legacy filtrait tr.transitioned_at >= started_at AND <= resolved_at
      const trans = allTrans.filter(
        (t) => t.transitionedAt >= sample.startedAt && t.transitionedAt <= sample.doneAt,
      );
      if (trans.length === 0) {continue;}

      let activeDays = 0;
      let queueDays = 0;
      for (let i = 0; i < trans.length; i++) {
        const start = trans[i].transitionedAt;
        const end = i + 1 < trans.length ? trans[i + 1].transitionedAt : sample.doneAt;
        if (new Date(end).getTime() <= new Date(start).getTime()) {continue;}
        const days = ctx.workingDaysBetween(start, end);
        const status = trans[i].toStatus;
        if (activeSet.has(status)) {activeDays += days;}
        else if (queueSet.has(status)) {queueDays += days;}
        // sinon : statut hors flux mesuré (TODO retour, done) -> ignoré.
      }

      const total = activeDays + queueDays;
      if (total <= 0) {continue;}
      out.push({
        issueKey: sample.issueKey,
        startedAt: sample.startedAt,
        resolvedAt: sample.doneAt,
        activeDays,
        queueDays,
        totalDays: total,
        flowEfficiency: activeDays / total,
      });
    }

    let kept = out;
    let excluded = 0;
    if (ctx.config.excludeOutliers !== false && out.length >= 4) {
      const totals = out.map((i) => i.totalDays);
      const { kept: keptTotals } = removeUpperOutliers(totals);
      const upper = keptTotals.length > 0 ? keptTotals[keptTotals.length - 1] : Infinity;
      kept = out.filter((i) => i.totalDays <= upper);
      excluded = out.length - kept.length;
    }

    const totalActive = kept.reduce((a, b) => a + b.activeDays, 0);
    const totalQueue = kept.reduce((a, b) => a + b.queueDays, 0);
    const aggregate = totalActive + totalQueue > 0 ? totalActive / (totalActive + totalQueue) : 0;
    const sortedFE = kept.map((i) => i.flowEfficiency).sort((a, b) => a - b);

    return {
      count: kept.length,
      excludedOutliers: excluded,
      aggregateFlowEfficiency: aggregate,
      medianFlowEfficiency: percentile(sortedFE, 50),
      p15FlowEfficiency: percentile(sortedFE, 15),
      totalActiveDays: totalActive,
      totalQueueDays: totalQueue,
      issues: kept,
      unit: "ratio (actif / total)",
    };
  },
};

function emptyResult(): FlowEfficiencySummary {
  return {
    count: 0,
    excludedOutliers: 0,
    aggregateFlowEfficiency: 0,
    medianFlowEfficiency: 0,
    p15FlowEfficiency: 0,
    totalActiveDays: 0,
    totalQueueDays: 0,
    issues: [],
    unit: "ratio (actif / total)",
  };
}

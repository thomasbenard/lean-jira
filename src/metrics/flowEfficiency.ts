import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { buildDeliveredCte, percentile, removeUpperOutliers, workingDaysBetween } from "./utils";

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

  compute(db: Database.Database, config: MetricConfig): FlowEfficiencySummary {
    const active = config.activeStatuses ?? [];
    const queue = config.queueStatuses ?? [];
    if (active.length === 0) return emptyResult();

    const todoPh = config.todoStatuses.map(() => "?").join(",");
    const devStartPh = config.devStartStatuses.map(() => "?").join(",");
    const delivered = buildDeliveredCte(config.doneStatuses);
    const cutoffSql = config.cutoffDate ? "AND d.done_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND d.done_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    // Population identique à cycle-time : issues team-done passées par TODO + dev start.
    const issues = db.prepare(`
      WITH ${delivered.cte}
      SELECT i.key, d.done_at AS resolved_at, MIN(t.transitioned_at) AS started_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${cutoffSql} ${endSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${todoPh}))
      GROUP BY i.key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...cutoffArgs,
      ...endArgs,
      ...config.todoStatuses,
    ) as Array<{ key: string; resolved_at: string; started_at: string }>;

    const getTransitions = db.prepare(`
      SELECT to_status, transitioned_at FROM transitions
      WHERE issue_key = ? AND transitioned_at >= ?
      ORDER BY transitioned_at ASC, id ASC
    `);

    const out: FlowEfficiencyIssue[] = [];
    for (const issue of issues) {
      const trans = getTransitions.all(issue.key, issue.started_at) as Array<{
        to_status: string;
        transitioned_at: string;
      }>;
      if (trans.length === 0) continue;

      let activeDays = 0;
      let queueDays = 0;
      for (let i = 0; i < trans.length; i++) {
        const start = trans[i].transitioned_at;
        const end = i + 1 < trans.length ? trans[i + 1].transitioned_at : issue.resolved_at;
        if (new Date(end).getTime() <= new Date(start).getTime()) continue;
        const days = workingDaysBetween(start, end);
        const status = trans[i].to_status;
        if (active.includes(status)) activeDays += days;
        else if (queue.includes(status)) queueDays += days;
        // sinon : statut hors flux mesuré (TODO retour, done) -> ignoré.
      }

      const total = activeDays + queueDays;
      if (total <= 0) continue;
      out.push({
        issueKey: issue.key,
        startedAt: issue.started_at,
        resolvedAt: issue.resolved_at,
        activeDays,
        queueDays,
        totalDays: total,
        flowEfficiency: activeDays / total,
      });
    }

    let kept = out;
    let excluded = 0;
    if (config.excludeOutliers !== false && out.length >= 4) {
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

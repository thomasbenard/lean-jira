import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildExcludeIssueTypesFragment, buildWindowFragment, percentile, placeholders, removeUpperOutliers, workingDaysBetween } from "./utils";

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
    if (active.length === 0) {return emptyResult();}

    const devStartPh = placeholders(config.devStartStatuses);
    const delivered = buildDeliveredCte(config.doneStatuses);
    const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    // Population identique à cycle-time + transitions cycle agrégées en une seule requête
    // pour éviter N requêtes (une par issue).
    const rows = db.prepare(`
      WITH ${delivered.cte},
      eligible AS (
        SELECT i.key, d.done_at AS resolved_at, MIN(t.transitioned_at) AS started_at
        FROM transitions t
        JOIN issues i ON i.key = t.issue_key
        JOIN delivered d ON d.issue_key = t.issue_key
        WHERE t.to_status IN (${devStartPh})
          ${excludeSql} ${cutoffSql} ${endSql}
        GROUP BY i.key, d.done_at
      )
      SELECT e.key, e.resolved_at, e.started_at, tr.to_status, tr.transitioned_at
      FROM eligible e
      JOIN transitions tr ON tr.issue_key = e.key
        AND tr.transitioned_at >= e.started_at
        AND tr.transitioned_at <= e.resolved_at
      ORDER BY e.key ASC, tr.transitioned_at ASC, tr.id ASC
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      ...excludeArgs,
      ...cutoffArgs,
      ...endArgs,
    ) as { key: string; resolved_at: string; started_at: string; to_status: string; transitioned_at: string }[];

    // Grouper les transitions par issue en mémoire
    interface IssueEntry { key: string; resolved_at: string; started_at: string; trans: { to_status: string; transitioned_at: string }[] }
    const issueMap = new Map<string, IssueEntry>();
    for (const r of rows) {
      let entry = issueMap.get(r.key);
      if (!entry) {
        entry = { key: r.key, resolved_at: r.resolved_at, started_at: r.started_at, trans: [] };
        issueMap.set(r.key, entry);
      }
      entry.trans.push({ to_status: r.to_status, transitioned_at: r.transitioned_at });
    }

    const out: FlowEfficiencyIssue[] = [];
    for (const issue of issueMap.values()) {
      if (issue.trans.length === 0) {continue;}

      let activeDays = 0;
      let queueDays = 0;
      for (let i = 0; i < issue.trans.length; i++) {
        const start = issue.trans[i].transitioned_at;
        const end = i + 1 < issue.trans.length ? issue.trans[i + 1].transitioned_at : issue.resolved_at;
        if (new Date(end).getTime() <= new Date(start).getTime()) {continue;}
        const days = workingDaysBetween(start, end);
        const status = issue.trans[i].to_status;
        if (active.includes(status)) {activeDays += days;}
        else if (queue.includes(status)) {queueDays += days;}
        // sinon : statut hors flux mesuré (TODO retour, done) -> ignoré.
      }

      const total = activeDays + queueDays;
      if (total <= 0) {continue;}
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

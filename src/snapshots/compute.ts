import type { Store } from "../store/types";
import type { IssueRecord, TransitionRecord, SnapshotRecord } from "../store/types";
import { type MetricConfig } from "../metrics/types";
import { ALL_METRICS } from "../metrics";
import { BUCKET_ORDER, type DurationStats, isoWeek } from "../metrics/utils";
import { type DevTimeAllocationSummary } from "../metrics/devTimeAllocation";
import { type BugBacklogResult } from "../metrics/bugBacklog";
import { type StageTimeSummary } from "../metrics/stageTimeBreakdown";
import { type WipPerRoleResult } from "../metrics/wipPerRole";
import { type StageThroughputGapResult } from "../metrics/stageThroughputGap";
import { type HandoffReworkResult } from "../metrics/handoffRework";
import { type FirstTimeRightResult } from "../metrics/firstTimeRight";
import { type ReworkCostResult } from "../metrics/reworkCost";
import { type BottleneckAnalysisResult } from "../metrics/bottleneckAnalysis";
import { now } from "../clock";
import { buildMetricsContext } from "../metrics/context";

export const DEFAULT_ROLLING_WINDOW_DAYS = 30;
const WEEK_DAYS = 7;
const WEEKLY_METRICS = new Set(["throughput", "throughput-weighted", "bug-throughput", "dev-time-allocation", "bug-backlog", "handoff-rework", "first-time-right"]);
// Métriques cumulatives : fenêtre depuis cutoffDate global (pas 30j glissants).
// Permet comparaison directe avec `npm run metrics`.
// rework-cost est cumulatif : byWeek couvre tout l'historique, on extrait la semaine du snapshot.
const CUMULATIVE_METRICS = new Set(["lead-time-by-size", "cycle-time-by-size", "aging-wip", "rework-cost"]);

// Métriques gérées manuellement ou à sauter dans la boucle runAllMetrics.
const SKIP_METRICS = new Set(["wip", "wip-per-role", "forecast", "scope-change-rate"]);

export interface SnapshotRow {
  snapshot_date: string;
  metric_name: string;
  bucket: string;
  stat: string;
  value: number;
}

function toSnapshotRecord(row: SnapshotRow): SnapshotRecord {
  return {
    snapshotDate: row.snapshot_date,
    metricName: row.metric_name,
    bucket: row.bucket,
    stat: row.stat,
    value: row.value,
  };
}

export function backfillSnapshots(store: Store, baseConfig: MetricConfig): number {
  const cutoff = baseConfig.cutoffDate ?? "2024-01-01";
  const dates = generateWeekEndings(cutoff);

  const allRows: SnapshotRecord[] = [];
  for (const date of dates) {
    for (const row of computeSnapshot(store, date, baseConfig)) {
      allRows.push(toSnapshotRecord(row));
    }
  }

  store.snapshots.replaceAll(allRows);

  const currentWindow = baseConfig.snapshotWindowDays ?? DEFAULT_ROLLING_WINDOW_DAYS;
  store.appConfig.set("snapshot_window_days", String(currentWindow));

  return dates.length;
}

export function generateWeekEndings(cutoffISO: string): string[] {
  const dates: string[] = [];
  const start = new Date(cutoffISO + "T00:00:00Z");
  // Aligner sur dimanche (fin de semaine ISO précédente).
  const dayOfWeek = start.getUTCDay();
  const daysToSunday = (7 - dayOfWeek) % 7;
  start.setUTCDate(start.getUTCDate() + daysToSunday);

  const today = now();
  while (start <= today) {
    dates.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 7);
  }
  return dates;
}

function subDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeSnapshot(store: Store, date: string, baseConfig: MetricConfig): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const rollingWindow = baseConfig.snapshotWindowDays ?? DEFAULT_ROLLING_WINDOW_DAYS;

  // Charger transitions et issues une seule fois pour les helpers WIP (JS pur, pas de SQL)
  const allTransitions = store.transitions.all();
  const allIssues = store.issues.all();

  // WIP historique (pas de contexte de métriques — logique point-in-time sur transitions brutes)
  const wipValue = computeHistoricWip(allTransitions, allIssues, date, baseConfig);
  rows.push({ snapshot_date: date, metric_name: "wip", bucket: "", stat: "count", value: wipValue });

  const wipPerRole = computeHistoricWipPerRole(allTransitions, allIssues, date, baseConfig);
  for (const role of ["dev", "qa", "po"] as const) {
    rows.push({ snapshot_date: date, metric_name: "wip-per-role", bucket: role, stat: "count", value: wipPerRole[role] });
  }

  // Pour chaque métrique non exclue, on construit un contexte avec la fenêtre adaptée
  // et on exécute uniquement cette métrique (via runAllMetrics sur un store, résultat filtré)
  for (const metric of ALL_METRICS) {
    if (SKIP_METRICS.has(metric.name)) { continue; }

    const isWeekly = WEEKLY_METRICS.has(metric.name);
    const isCumulative = CUMULATIVE_METRICS.has(metric.name);
    const windowDays = isWeekly ? WEEK_DAYS : rollingWindow;
    const cfg: MetricConfig = {
      ...baseConfig,
      cutoffDate: isCumulative ? baseConfig.cutoffDate : subDaysISO(date, windowDays),
      windowEndDate: date,
    };

    const ctx = buildMetricsContext(store, cfg);
    const result = metric.compute(ctx) as unknown as Record<string, unknown>;
    rows.push(...extractStats(date, metric.name, result));
  }

  return rows;
}

export function extractStats(date: string, metricName: string, result: Record<string, unknown>): SnapshotRow[] {
  const out: SnapshotRow[] = [];

  if ("buckets" in result) {
    const buckets = result.buckets as Partial<Record<string, DurationStats>>;
    for (const b of BUCKET_ORDER) {
      const s = buckets[b];
      if (!s || s.count === 0) {continue;}
      out.push({ snapshot_date: date, metric_name: metricName, bucket: b, stat: "count", value: s.count });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: b, stat: "median", value: s.medianDays });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: b, stat: "p85", value: s.p85Days });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: b, stat: "p95", value: s.p95Days });
    }
  } else if ("avgDays" in result) {
    const r = result as unknown as DurationStats;
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "median", value: r.medianDays });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "p85", value: r.p85Days });
  } else if ("riskCounts" in result) {
    const r = result as unknown as {
      count: number;
      percentiles: { p50: number; p85: number; p95: number };
      riskCounts: { ok: number; watch: number; atRisk: number; critical: number };
    };
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "ok", value: r.riskCounts.ok });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "watch", value: r.riskCounts.watch });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "atRisk", value: r.riskCounts.atRisk });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "critical", value: r.riskCounts.critical });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "p50", value: r.percentiles.p50 });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "p85", value: r.percentiles.p85 });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "p95", value: r.percentiles.p95 });
  } else if ("aggregateFlowEfficiency" in result) {
    const r = result as unknown as {
      count: number;
      aggregateFlowEfficiency: number;
      medianFlowEfficiency: number;
      totalActiveDays: number;
      totalQueueDays: number;
    };
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "aggregate", value: r.aggregateFlowEfficiency });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "median", value: r.medianFlowEfficiency });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "activeDays", value: r.totalActiveDays });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "queueDays", value: r.totalQueueDays });
  } else if ("openCount" in result) {
    const r = result as unknown as BugBacklogResult;
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "openCount", value: r.openCount });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "netFlow", value: r.netFlow });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "created", value: r.created });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "closed", value: r.closed });
  } else if ("avgBugRatio" in result) {
    const r = result as unknown as DevTimeAllocationSummary;
    let totalFeature = 0;
    let totalBug = 0;
    for (const w of r.byWeek) { totalFeature += w.featureDays; totalBug += w.bugDays; }
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "featureDays", value: totalFeature });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "bugDays", value: totalBug });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "bugRatio", value: r.avgBugRatio });
  // doit précéder "reworkRatio" et "byWeek" — ReworkCostResult contient les deux
  } else if ("totalReworkDays" in result) {
    const r = result as unknown as ReworkCostResult;
    const weekKey = isoWeek(date);
    const weekEntry = r.byWeek.find((w) => w.week === weekKey);
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkedCount", value: r.reworkedCount });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkRatio", value: r.reworkRatio });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "totalReworkDays", value: weekEntry?.reworkDays ?? 0 });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "avgReworkDays", value: r.avgReworkDaysPerReworkedTicket });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkCostRatio", value: r.reworkCostRatio });
  } else if ("reworkRatio" in result) {
    const r = result as unknown as HandoffReworkResult;
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkRatio", value: r.reworkRatio });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "avgReworks", value: r.avgReworks });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "qaToDev", stat: "count", value: r.byReworkType.qaToDev });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "poToQa", stat: "count", value: r.byReworkType.poToQa });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "poDev", stat: "count", value: r.byReworkType.poDev });
  } else if ("avgShareByRole" in result) {
    const r = result as unknown as StageTimeSummary;
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    for (const role of ["dev", "qa", "po"] as const) {
      const s = r.byRole[role];
      if (s.count === 0) {continue;}
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "median", value: s.medianDays });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "p85", value: s.p85Days });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgShare", value: r.avgShareByRole[role] });
    }
  } else if ("primaryBottleneck" in result) {
    const r = result as unknown as BottleneckAnalysisResult;
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    for (const role of ["dev", "qa", "po"] as const) {
      const s = r.byRole[role];
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "score", value: s.score });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "rank", value: s.rank });
    }
  } else if ("byRole" in result) {
    // wip-per-role bypasse extractStats via computeHistoricWipPerRole — cette branche
    // est une protection explicite pour tout futur metric avec shape WipPerRoleResult.
    const r = result as unknown as WipPerRoleResult;
    for (const role of ["dev", "qa", "po"] as const) {
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "count", value: r.byRole[role].count });
    }
  } else if ("ftrByRole" in result) {
    const r = result as unknown as FirstTimeRightResult;
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
    for (const role of ["dev", "qa", "po"] as const) {
      const s = r.ftrByRole[role];
      if (s.eligible === 0) {continue;}
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "ftrRate", value: s.ftrRate });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgPasses", value: s.avgPasses });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "eligible", value: s.eligible });
    }
  } else if ("avgNetByRole" in result) {
    const r = result as unknown as StageThroughputGapResult;
    for (const role of ["dev", "qa", "po"] as const) {
      const inKey = `${role}In` as const;
      const outKey = `${role}Out` as const;
      const totalIn = r.byWeek.reduce((s, w) => s + w[inKey], 0);
      const totalOut = r.byWeek.reduce((s, w) => s + w[outKey], 0);
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "in", value: totalIn });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "out", value: totalOut });
      out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgNet", value: r.avgNetByRole[role] });
    }
  } else if ("byWeek" in result) {
    const byWeek = result.byWeek as {
      count?: number;
      estimatedDays?: number;
      estimatedCount?: number;
      unestimatedCount?: number;
    }[];
    let totalCount = 0;
    let totalDays = 0;
    let isWeighted = false;
    for (const w of byWeek) {
      if (typeof w.count === "number") {totalCount += w.count;}
      else {totalCount += (w.estimatedCount ?? 0) + (w.unestimatedCount ?? 0);}
      if (typeof w.estimatedDays === "number") {
        totalDays += w.estimatedDays;
        isWeighted = true;
      }
    }
    out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: totalCount });
    if (isWeighted) {
      out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "estimatedDays", value: totalDays });
    }
  }

  return out;
}

// WIP par rôle historique : même logique que computeHistoricWip mais filtré par statuts de rôle.
// Implémentation JS pure : pas de SQL direct — satisfait l'invariant "pas de SQL hors src/store/sqlite".
function computeHistoricWipPerRole(
  allTransitions: TransitionRecord[],
  allIssues: IssueRecord[],
  date: string,
  config: MetricConfig,
): { dev: number; qa: number; po: number } {
  const roles = {
    dev: new Set(config.devStatuses ?? []),
    qa: new Set(config.qaStatuses ?? []),
    po: new Set(config.poStatuses ?? []),
  };

  const issueByKey = new Map<string, IssueRecord>();
  for (const i of allIssues) { issueByKey.set(i.key, i); }

  const lastStatus = computeLastStatusByIssue(allTransitions, date);

  const result = { dev: 0, qa: 0, po: 0 };
  for (const [issueKey, status] of lastStatus) {
    const issue = issueByKey.get(issueKey);
    if (!issue) { continue; }
    // Exclusion des issues résolues avant ou à la date (comparaison lexicographique ISO)
    if (issue.resolvedAt !== null && issue.resolvedAt.slice(0, 10) <= date) { continue; }
    for (const role of ["dev", "qa", "po"] as const) {
      if (roles[role].size > 0 && roles[role].has(status)) {
        result[role]++;
      }
    }
  }
  return result;
}

// WIP historique : pour chaque issue, dernier statut connu avant la date D.
// Si ce statut est in_progress et que l'issue n'est pas résolue avant D, c'est WIP.
// Note: pas de scoping sprint car les sprints historiques ne sont pas tracés.
// Note: resolved_at = Jira resolutiondate, pas done_at — comportement préservé intentionnellement.
// Implémentation JS pure : pas de SQL direct — satisfait l'invariant "pas de SQL hors src/store/sqlite".
function computeHistoricWip(
  allTransitions: TransitionRecord[],
  allIssues: IssueRecord[],
  date: string,
  config: MetricConfig,
): number {
  const inProgressSet = new Set(config.inProgressStatuses);

  const issueByKey = new Map<string, IssueRecord>();
  for (const i of allIssues) { issueByKey.set(i.key, i); }

  const lastStatus = computeLastStatusByIssue(allTransitions, date);

  let count = 0;
  for (const [issueKey, status] of lastStatus) {
    if (!inProgressSet.has(status)) { continue; }
    const issue = issueByKey.get(issueKey);
    if (!issue) { continue; }
    // Exclusion des issues résolues avant ou à la date (comparaison lexicographique ISO)
    if (issue.resolvedAt !== null && issue.resolvedAt.slice(0, 10) <= date) { continue; }
    count++;
  }
  return count;
}

// Retourne la Map<issueKey, lastStatus> pour toutes les transitions dont transitionedAt <= date.
// Les transitions doivent être ordonnées chronologiquement (ordre d'insertion en DB = ordre temporel).
function computeLastStatusByIssue(allTransitions: TransitionRecord[], date: string): Map<string, string> {
  const lastStatus = new Map<string, string>();
  for (const t of allTransitions) {
    if (t.transitionedAt.slice(0, 10) <= date) {
      lastStatus.set(t.issueKey, t.toStatus);
    }
  }
  return lastStatus;
}

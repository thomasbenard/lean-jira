import type Database from "better-sqlite3";
import { type MetricConfig } from "../metrics/types";
import { ALL_METRICS } from "../metrics";
import { BUCKET_ORDER, placeholders, type DurationStats } from "../metrics/utils";
import { type DevTimeAllocationSummary } from "../metrics/devTimeAllocation";
import { type BugBacklogResult } from "../metrics/bugBacklog";
import { type StageTimeSummary } from "../metrics/stageTimeBreakdown";
import { type WipPerRoleResult } from "../metrics/wipPerRole";
import { type StageThroughputGapResult } from "../metrics/stageThroughputGap";
import { type HandoffReworkResult } from "../metrics/handoffRework";
import { type FirstTimeRightResult } from "../metrics/firstTimeRight";
import { now } from "../clock";

const ROLLING_WINDOW_DAYS = 30;
const WEEK_DAYS = 7;
const WEEKLY_METRICS = new Set(["throughput", "throughput-weighted", "bug-throughput", "dev-time-allocation", "bug-backlog"]);
// Métriques cumulatives : fenêtre depuis cutoffDate global (pas 30j glissants).
// Permet comparaison directe avec `npm run metrics`.
const CUMULATIVE_METRICS = new Set(["lead-time-by-size", "cycle-time-by-size", "aging-wip"]);

export interface SnapshotRow {
  snapshot_date: string;
  metric_name: string;
  bucket: string;
  stat: string;
  value: number;
}

export function backfillSnapshots(db: Database.Database, baseConfig: MetricConfig): number {
  const cutoff = baseConfig.cutoffDate ?? "2024-01-01";
  const dates = generateWeekEndings(cutoff);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO metric_snapshots (snapshot_date, metric_name, bucket, stat, value)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    db.exec("DELETE FROM metric_snapshots");
    for (const date of dates) {
      for (const row of computeSnapshot(db, date, baseConfig)) {
        insert.run(row.snapshot_date, row.metric_name, row.bucket, row.stat, row.value);
      }
    }
  });
  tx();

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

function computeSnapshot(db: Database.Database, date: string, baseConfig: MetricConfig): SnapshotRow[] {
  const rows: SnapshotRow[] = [];

  for (const metric of ALL_METRICS) {
    if (metric.name === "wip") {
      const wipValue = computeHistoricWip(db, date, baseConfig);
      rows.push({ snapshot_date: date, metric_name: "wip", bucket: "", stat: "count", value: wipValue });
      continue;
    }
    if (metric.name === "wip-per-role") {
      const counts = computeHistoricWipPerRole(db, date, baseConfig);
      for (const role of ["dev", "qa", "po"] as const) {
        rows.push({ snapshot_date: date, metric_name: "wip-per-role", bucket: role, stat: "count", value: counts[role] });
      }
      continue;
    }
    // forecast = Monte Carlo non déterministe, pas de stat utile à snapshotter.
    if (metric.name === "forecast") {continue;}
    // scope-change-rate = sortie bySprint non mappable au format (snapshot_date, bucket, stat).
    if (metric.name === "scope-change-rate") {continue;}

    const isWeekly = WEEKLY_METRICS.has(metric.name);
    const isCumulative = CUMULATIVE_METRICS.has(metric.name);
    const windowDays = isWeekly ? WEEK_DAYS : ROLLING_WINDOW_DAYS;
    const cfg: MetricConfig = {
      ...baseConfig,
      cutoffDate: isCumulative ? baseConfig.cutoffDate : subDaysISO(date, windowDays),
      windowEndDate: date,
    };

    const result = metric.compute(db, cfg) as unknown as Record<string, unknown>;
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
function computeHistoricWipPerRole(
  db: Database.Database,
  date: string,
  config: MetricConfig,
): { dev: number; qa: number; po: number } {
  const roles = {
    dev: config.devStatuses ?? [],
    qa: config.qaStatuses ?? [],
    po: config.poStatuses ?? [],
  };
  const result = { dev: 0, qa: 0, po: 0 };

  for (const role of ["dev", "qa", "po"] as const) {
    const statuses = roles[role];
    if (statuses.length === 0) {continue;}
    const ph = placeholders(statuses);
    const row = db
      .prepare(
        `WITH last_status AS (
          SELECT issue_key, to_status, MAX(transitioned_at) AS last_at
          FROM transitions
          WHERE substr(transitioned_at, 1, 10) <= ?
          GROUP BY issue_key
        )
        SELECT COUNT(*) AS c
        FROM last_status l
        JOIN issues i ON i.key = l.issue_key
        WHERE l.to_status IN (${ph})
          AND (i.resolved_at IS NULL OR substr(i.resolved_at, 1, 10) > ?)`,
      )
      .get(date, ...statuses, date) as { c: number };
    result[role] = row.c;
  }
  return result;
}

// WIP historique : pour chaque issue, dernier statut connu avant la date D.
// Si ce statut est in_progress et que l'issue n'est pas résolue avant D, c'est WIP.
// Note: pas de scoping sprint car les sprints historiques ne sont pas tracés.
function computeHistoricWip(db: Database.Database, date: string, config: MetricConfig): number {
  const inProgressPh = config.inProgressStatuses.map(() => "?").join(",");
  const row = db.prepare(`
    WITH last_status AS (
      SELECT issue_key, to_status, MAX(transitioned_at) AS last_at
      FROM transitions
      WHERE substr(transitioned_at, 1, 10) <= ?
      GROUP BY issue_key
    )
    SELECT COUNT(*) AS c
    FROM last_status l
    JOIN issues i ON i.key = l.issue_key
    WHERE l.to_status IN (${inProgressPh})
      AND (i.resolved_at IS NULL OR substr(i.resolved_at, 1, 10) > ?)
  `).get(date, ...config.inProgressStatuses, date) as { c: number };
  return row.c;
}

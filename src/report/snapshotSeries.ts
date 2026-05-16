import type { ChartDef } from "./chartDefs";

export interface SnapshotRow {
  snapshot_date: string;
  metric_name: string;
  bucket: string;
  stat: string;
  value: number;
}

export interface BucketStats {
  count: number;
  median: number;
  p85: number;
}

export interface ChartSeries {
  dates: string[];
  series: Record<string, number[]>;
}

function buildSeries(snapshots: SnapshotRow[], bucket: string, stats: string[]): ChartSeries {
  const dateSet = new Set<string>();
  const byKey = new Map<string, Map<string, number>>();
  for (const stat of stats) {byKey.set(stat, new Map());}

  for (const s of snapshots) {
    if (s.bucket !== bucket) {continue;}
    if (!stats.includes(s.stat)) {continue;}
    dateSet.add(s.snapshot_date);
    byKey.get(s.stat)?.set(s.snapshot_date, s.value);
  }

  const dates = [...dateSet].sort();
  const series: Record<string, number[]> = {};
  for (const stat of stats) {
    const m = byKey.get(stat);
    series[stat] = dates.map((d) => m?.get(d) ?? 0);
  }
  return { dates, series };
}

export function buildBucketSeries(snapshots: SnapshotRow[], bucket: string, stats: string[]): ChartSeries {
  return buildSeries(snapshots, bucket, stats);
}

export function buildRoleSeries(snapshots: SnapshotRow[], buckets: string[], stat: string): ChartSeries {
  const bucketSet = new Set(buckets);
  const dateSet = new Set<string>();
  const byBucket = new Map<string, Map<string, number>>();
  for (const b of buckets) { byBucket.set(b, new Map()); }

  for (const s of snapshots) {
    if (!bucketSet.has(s.bucket) || s.stat !== stat) { continue; }
    dateSet.add(s.snapshot_date);
    byBucket.get(s.bucket)?.set(s.snapshot_date, s.value);
  }

  const dates = [...dateSet].sort();
  const series: Record<string, number[]> = {};
  for (const b of buckets) {
    const m = byBucket.get(b);
    series[b] = dates.map((d) => m?.get(d) ?? 0);
  }
  return { dates, series };
}

export function buildAllChartData(
  metricRows: (name: string) => SnapshotRow[],
  defs: ChartDef[],
): Record<string, ChartSeries> {
  // pourquoi : le template `report.hbs` lit `CHARTS.<key>` (e.g. `CHARTS.leadTime`),
  // pas `CHARTS.<id>` (qui est l'ID du canvas DOM). Garder le keying par `def.key`
  // pour rester compatible tant que la migration vers le dispatcher CHART_DEFS n'est pas terminée.
  const result: Record<string, ChartSeries> = {};
  for (const def of defs) {
    if (def.data === null) { continue; }
    const rows = metricRows(def.data.metricName);
    if (def.data.mode === "stats") {
      result[def.key] = buildSeries(rows, def.data.bucket, def.data.stats);
    } else {
      result[def.key] = buildRoleSeries(rows, def.data.roles, def.data.stat);
    }
  }
  return result;
}

export function pickValue(rows: SnapshotRow[], metric: string, bucket: string, stat: string): number | null {
  const r = rows.find((x) => x.metric_name === metric && x.bucket === bucket && x.stat === stat);
  return r ? r.value : null;
}

export function latestBySize(rows: SnapshotRow[]): Partial<Record<string, BucketStats>> {
  const out: Partial<Record<string, BucketStats>> = {};
  for (const r of rows) {
    const entry: BucketStats = out[r.bucket] ?? { count: 0, median: 0, p85: 0 };
    out[r.bucket] = entry;
    if (r.stat === "count") {entry.count = r.value;}
    else if (r.stat === "median") {entry.median = r.value;}
    else if (r.stat === "p85") {entry.p85 = r.value;}
  }
  return out;
}

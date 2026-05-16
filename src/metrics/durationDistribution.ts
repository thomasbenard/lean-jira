import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { bucketize, BUCKET_ORDER, type HistogramBin, type SizeBucket } from "./utils";

export type DistributionBin = HistogramBin;

// Bins de 1 jour-ouvré : aligne l'axe x sur l'unité de mesure des durées et
// laisse la courbe KDE porter le lissage visuel. Une largeur agrégée masquerait
// les pics journaliers que le PDF cherche à révéler.
function buildUnitBins(values: number[], max: number): HistogramBin[] {
  if (values.length === 0 || max <= 0) { return []; }
  const binCount = Math.max(1, Math.ceil(max + 0.0001));
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) { bins.push({ start: i, end: i + 1, count: 0 }); }
  for (const v of values) {
    const idx = Math.min(bins.length - 1, Math.floor(v));
    bins[idx].count++;
  }
  return bins;
}

export interface DistributionPoint {
  x: number;
  density: number;
  cdf: number;
}

export interface DistributionSeries {
  count: number;
  bins: DistributionBin[];
  kde: DistributionPoint[];
  hasKde: boolean;
  max: number;
}

export interface DurationDistributionResult {
  cycle: { global: DistributionSeries; byBucket: Partial<Record<SizeBucket, DistributionSeries>> };
  lead: { global: DistributionSeries; byBucket: Partial<Record<SizeBucket, DistributionSeries>> };
}

const KDE_POINTS = 50;

function stddev(values: number[]): number {
  if (values.length < 2) { return 0; }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

function silvermanBandwidth(sigma: number, n: number): number {
  return 1.06 * sigma * Math.pow(n, -1 / 5);
}

function gaussianKernel(u: number): number {
  return Math.exp(-(u * u) / 2) / Math.sqrt(2 * Math.PI);
}

function buildKdeAndCdf(values: number[], max: number, h: number | null): DistributionPoint[] {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const points: DistributionPoint[] = [];
  for (let i = 0; i < KDE_POINTS; i++) {
    const x = (i * max) / (KDE_POINTS - 1);
    let density = 0;
    if (h !== null && h > 0) {
      let sum = 0;
      for (const v of sorted) { sum += gaussianKernel((x - v) / h); }
      density = sum / (n * h);
    }
    let cnt = 0;
    for (const v of sorted) { if (v <= x) { cnt++; } else { break; } }
    points.push({ x, density, cdf: cnt / n });
  }
  return points;
}

function buildSeries(values: number[]): DistributionSeries {
  if (values.length === 0) {
    return { count: 0, bins: [], kde: [], hasKde: false, max: 0 };
  }
  const max = Math.max(...values);
  if (max === 0) {
    const kde = Array.from({ length: KDE_POINTS }, () => ({ x: 0, density: 0, cdf: 1 }));
    return {
      count: values.length,
      bins: [{ start: 0, end: 0, count: values.length }],
      kde,
      hasKde: false,
      max: 0,
    };
  }
  const bins = buildUnitBins(values, max);
  const sigma = stddev(values);
  const hasKde = values.length >= 4 && sigma > 0;
  const h = hasKde ? silvermanBandwidth(sigma, values.length) : null;
  const kde = buildKdeAndCdf(values, max, h);
  return { count: values.length, bins, kde, hasKde, max };
}

function bucketsByExposed(daysByBucket: Map<SizeBucket, number[]>): Partial<Record<SizeBucket, DistributionSeries>> {
  const out: Partial<Record<SizeBucket, DistributionSeries>> = {};
  for (const b of BUCKET_ORDER) {
    if (b === "BUG" || b === "UNESTIMATED") { continue; }
    const list = daysByBucket.get(b);
    if (list && list.length > 0) { out[b] = buildSeries(list); }
  }
  return out;
}

export const durationDistributionMetric: Metric<DurationDistributionResult> = {
  name: "duration-distribution",
  description: "Distribution PDF + CDF cycle-time et lead-time, global et par bucket",

  compute(ctx: MetricsContext): DurationDistributionResult {
    const bugTypes = new Set(ctx.config.bugIssueTypes);
    const todoSet = new Set(ctx.config.todoStatuses);

    const cycleAll: number[] = [];
    const leadAll: number[] = [];
    const cycleByBucket = new Map<SizeBucket, number[]>();
    const leadByBucket = new Map<SizeBucket, number[]>();

    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      const cycleDays = ctx.workingDaysBetween(sample.startedAt, sample.doneAt);
      const bucket = bucketize(
        { originalEstimateSeconds: issue.originalEstimateSeconds, storyPoints: issue.storyPoints, sizeLabel: issue.sizeLabel },
        bugTypes.has(issue.issueType),
        ctx.config.estimation,
      );
      cycleAll.push(cycleDays);
      let cb = cycleByBucket.get(bucket);
      if (!cb) { cb = []; cycleByBucket.set(bucket, cb); }
      cb.push(cycleDays);

      const list = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      const todoTransition = list.find((t) => todoSet.has(t.toStatus));
      if (!todoTransition) { continue; }
      if (sample.doneAt < todoTransition.transitionedAt) { continue; }
      const leadDays = ctx.workingDaysBetween(todoTransition.transitionedAt, sample.doneAt);
      leadAll.push(leadDays);
      let lb = leadByBucket.get(bucket);
      if (!lb) { lb = []; leadByBucket.set(bucket, lb); }
      lb.push(leadDays);
    }

    return {
      cycle: { global: buildSeries(cycleAll), byBucket: bucketsByExposed(cycleByBucket) },
      lead: { global: buildSeries(leadAll), byBucket: bucketsByExposed(leadByBucket) },
    };
  },
};

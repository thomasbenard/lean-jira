import { percentile } from "../metrics/utils";
import { now } from "../clock";
import type { SnapshotRow } from "./snapshotSeries";

export interface ThresholdPair {
  warn: number;
  crit: number;
}

export interface HealthThresholds {
  mode?: "static" | "dynamic";
  windowWeeks?: number;
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}

export type HealthSignal = "green" | "orange" | "red" | "none";

const DYNAMIC_MIN_WEEKS = 4;

export function computeDynamicThresholds(
  snapshots: SnapshotRow[],
  windowWeeks: number,
): Omit<HealthThresholds, "mode" | "windowWeeks"> {
  const cutoff = now();
  cutoff.setDate(cutoff.getDate() - windowWeeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const inWindow = snapshots.filter((s) => s.snapshot_date >= cutoffStr);

  function series(metric: string, bucket: string, stat: string): number[] {
    return inWindow
      .filter((s) => s.metric_name === metric && s.bucket === bucket && s.stat === stat)
      .map((s) => s.value)
      .sort((a, b) => a - b);
  }

  function threshold(metric: string, bucket: string, stat: string, warnPct: number, critPct: number): ThresholdPair | undefined {
    const sorted = series(metric, bucket, stat);
    if (sorted.length < DYNAMIC_MIN_WEEKS) { return undefined; }
    return { warn: percentile(sorted, warnPct), crit: percentile(sorted, critPct) };
  }

  return {
    leadTimeMedianDays:     threshold("lead-time",          "", "median", 50, 85),
    cycleTimeMedianDays:    threshold("cycle-time",         "", "median", 50, 85),
    bugCycleTimeMedianDays: threshold("bug-cycle-time",     "", "median", 50, 85),
    wipCount:               threshold("wip",                "", "count",  50, 85),
    bugRatio:               threshold("dev-time-allocation","", "bugRatio", 50, 85),
    throughputWeekly:       threshold("throughput",         "", "count",  50, 15),
  };
}

export function resolveThresholds(
  config: HealthThresholds | undefined,
  snapshots: SnapshotRow[],
): Omit<HealthThresholds, "mode" | "windowWeeks"> {
  if (!config) { return {}; }
  const mode: string = config.mode ?? "static";
  if (mode !== "static" && mode !== "dynamic") {
    console.warn(`[report] healthThresholds.mode inconnu "${mode}", fallback "static".`);
  }
  if (mode !== "dynamic") { return config; }
  const dynamic = computeDynamicThresholds(snapshots, config.windowWeeks ?? 12);
  return {
    leadTimeMedianDays:     config.leadTimeMedianDays     ?? dynamic.leadTimeMedianDays,
    cycleTimeMedianDays:    config.cycleTimeMedianDays    ?? dynamic.cycleTimeMedianDays,
    throughputWeekly:       config.throughputWeekly       ?? dynamic.throughputWeekly,
    wipCount:               config.wipCount               ?? dynamic.wipCount,
    bugCycleTimeMedianDays: config.bugCycleTimeMedianDays ?? dynamic.bugCycleTimeMedianDays,
    bugRatio:               config.bugRatio               ?? dynamic.bugRatio,
  };
}

export function evalLowerBetter(value: number | null, t: ThresholdPair | undefined): HealthSignal {
  if (value === null || t === undefined) {return "none";}
  if (value <= t.warn) {return "green";}
  if (value <= t.crit) {return "orange";}
  return "red";
}

export function evalHigherBetter(value: number | null, t: ThresholdPair | undefined): HealthSignal {
  if (value === null || t === undefined) {return "none";}
  if (value >= t.warn) {return "green";}
  if (value >= t.crit) {return "orange";}
  return "red";
}

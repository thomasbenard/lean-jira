import { type MetricConfig } from "../metrics/types";
import { cycleTimeMetric } from "../metrics/cycleTime";
import { leadTimeMetric } from "../metrics/leadTime";
import { throughputMetric } from "../metrics/throughput";
import { bugThroughputMetric } from "../metrics/bugThroughput";
import { throughputWeightedMetric } from "../metrics/throughputWeighted";
import { handoffReworkMetric } from "../metrics/handoffRework";
import { firstTimeRightMetric } from "../metrics/firstTimeRight";
import { reworkCostMetric } from "../metrics/reworkCost";
import { now } from "../clock";
import type { ReadStore } from "../store/types";
import { buildBaseMetricsContext, deriveMetricsContext } from "../metrics/context";

export interface SprintChartSeries {
  labels: string[];
  series: Record<string, number[]>;
  hasActiveSprint: boolean;
}

export interface SprintRow {
  name: string;
  state: string;
  start_date: string;
  end_date: string | null;
}

export function buildSprintSeries(
  store: ReadStore,
  config: MetricConfig,
  sprints: SprintRow[],
): {
  throughput: SprintChartSeries;
  bugThroughput: SprintChartSeries;
  throughputWeighted: SprintChartSeries;
  leadTime: SprintChartSeries;
  cycleTime: SprintChartSeries;
} {
  const labels: string[] = [];
  const thrCounts: number[] = [];
  const bugCounts: number[] = [];
  const wgtDays: number[] = [];
  const leadMedians: number[] = [];
  const leadP85s: number[] = [];
  const cycleMedians: number[] = [];
  const cycleP85s: number[] = [];

  const hasActive = sprints.length > 0 && sprints[sprints.length - 1].state === "active";

  // pourquoi : indexes stables sur tous les sprints — seuls cutoffDate/windowEndDate
  // varient par itération. Un seul build évite N rebuilds redondants (cf. ticket perf snapshots).
  const baseCtx = buildBaseMetricsContext(store, config);

  for (const sprint of sprints) {
    const isActive = sprint.state === "active";
    const windowEnd = sprint.end_date ?? now().toISOString().slice(0, 10);
    const cfg: MetricConfig = { ...config, cutoffDate: sprint.start_date, windowEndDate: windowEnd };
    const ctx = deriveMetricsContext(baseCtx, cfg);

    labels.push(isActive ? `${sprint.name} (en cours)` : sprint.name);

    const thrResult = throughputMetric.compute(ctx);
    thrCounts.push(thrResult.byWeek.reduce((s, w) => s + w.count, 0));

    const bugResult = bugThroughputMetric.compute(ctx);
    bugCounts.push(bugResult.byWeek.reduce((s, w) => s + w.count, 0));

    const wgtResult = throughputWeightedMetric.compute(ctx);
    wgtDays.push(wgtResult.byWeek.reduce((s, w) => s + w.estimatedDays, 0));

    const leadResult = leadTimeMetric.compute(ctx);
    leadMedians.push(leadResult.count > 0 ? leadResult.medianDays : 0);
    leadP85s.push(leadResult.count > 0 ? leadResult.p85Days : 0);

    const cycleResult = cycleTimeMetric.compute(ctx);
    cycleMedians.push(cycleResult.count > 0 ? cycleResult.medianDays : 0);
    cycleP85s.push(cycleResult.count > 0 ? cycleResult.p85Days : 0);
  }

  return {
    throughput: { labels, series: { count: thrCounts }, hasActiveSprint: hasActive },
    bugThroughput: { labels, series: { count: bugCounts }, hasActiveSprint: hasActive },
    throughputWeighted: { labels, series: { estimatedDays: wgtDays }, hasActiveSprint: hasActive },
    leadTime: { labels, series: { median: leadMedians, p85: leadP85s }, hasActiveSprint: hasActive },
    cycleTime: { labels, series: { median: cycleMedians, p85: cycleP85s }, hasActiveSprint: hasActive },
  };
}

export function buildRolesSprintSeries(
  store: ReadStore,
  config: MetricConfig,
  sprints: SprintRow[],
): {
  ftrByRole: SprintChartSeries;
  handoffReworkRatio: SprintChartSeries;
  handoffReworkByType: SprintChartSeries;
  reworkCost: SprintChartSeries;
} {
  const labels: string[] = [];
  const ftrDev: number[] = [];
  const ftrQa: number[] = [];
  const ftrPo: number[] = [];
  const reworkRatioArr: number[] = [];
  const qaToDevArr: number[] = [];
  const poToQaArr: number[] = [];
  const poDevArr: number[] = [];
  const reworkDaysArr: number[] = [];

  const hasActive = sprints.length > 0 && sprints[sprints.length - 1].state === "active";

  // pourquoi : indexes stables sur tous les sprints — seuls cutoffDate/windowEndDate varient.
  const baseCtx = buildBaseMetricsContext(store, config);

  for (const sprint of sprints) {
    const isActive = sprint.state === "active";
    const windowEnd = sprint.end_date ?? now().toISOString().slice(0, 10);
    const cfg: MetricConfig = { ...config, cutoffDate: sprint.start_date, windowEndDate: windowEnd };
    const ctx = deriveMetricsContext(baseCtx, cfg);

    labels.push(isActive ? `${sprint.name} (en cours)` : sprint.name);

    const ftr = firstTimeRightMetric.compute(ctx);
    ftrDev.push(ftr.ftrByRole.dev.ftrRate);
    ftrQa.push(ftr.ftrByRole.qa.ftrRate);
    ftrPo.push(ftr.ftrByRole.po.ftrRate);

    const handoff = handoffReworkMetric.compute(ctx);
    reworkRatioArr.push(handoff.reworkRatio);
    qaToDevArr.push(handoff.byReworkType.qaToDev);
    poToQaArr.push(handoff.byReworkType.poToQa);
    poDevArr.push(handoff.byReworkType.poDev);

    const rework = reworkCostMetric.compute(ctx);
    reworkDaysArr.push(rework.totalReworkDays);
  }

  return {
    ftrByRole: { labels, series: { dev: ftrDev, qa: ftrQa, po: ftrPo }, hasActiveSprint: hasActive },
    handoffReworkRatio: { labels, series: { reworkRatio: reworkRatioArr }, hasActiveSprint: hasActive },
    handoffReworkByType: { labels, series: { qaToDev: qaToDevArr, poToQa: poToQaArr, poDev: poDevArr }, hasActiveSprint: hasActive },
    reworkCost: { labels, series: { totalReworkDays: reworkDaysArr }, hasActiveSprint: hasActive },
  };
}

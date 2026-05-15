export type TabId = "delivery" | "quality" | "roles" | "forecast" | "advanced";

export type DataMode =
  | { mode: "stats"; metricName: string; bucket: string; stats: string[] }
  | { mode: "roleSeries"; metricName: string; roles: string[]; stat: string };

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export type ChartType =
  | { type: "line"; trendLine?: boolean }
  | { type: "bar"; stacked?: boolean }
  | { type: "custom"; rendererId: string };

export interface ChartDef {
  id: string;
  key: string;
  tab: TabId;
  titleKey: string;
  helpKey?: string;
  data: DataMode | null;
  chart: ChartType;
  series?: SeriesDef[];
  showWhen?: string;
  sprintKey?: string;
}

export type ChartDefResolved = Omit<ChartDef, "titleKey"> & { title: string };

export const CHART_DEFS: ChartDef[] = [
  // ── Delivery ──────────────────────────────────────────────────────────────
  {
    id: "leadTimeChart", key: "leadTime", tab: "delivery",
    titleKey: "report.chart.leadTime", helpKey: "leadTime",
    data: { mode: "stats", metricName: "lead-time", bucket: "", stats: ["median", "p85"] },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "median", label: "Médiane", color: "var(--c-median, #00e0d4)" },
      { key: "p85",    label: "P85",     color: "var(--c-p85, #ff8a3d)"   },
    ],
    sprintKey: "leadTime",
  },
  {
    id: "cycleTimeChart", key: "cycleTime", tab: "delivery",
    titleKey: "report.chart.cycleTime", helpKey: "cycleTime",
    data: { mode: "stats", metricName: "cycle-time", bucket: "", stats: ["median", "p85"] },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "median", label: "Médiane", color: "var(--c-median, #00e0d4)" },
      { key: "p85",    label: "P85",     color: "var(--c-p85, #ff8a3d)"   },
    ],
    sprintKey: "cycleTime",
  },
  {
    id: "throughputChart", key: "throughput", tab: "delivery",
    titleKey: "report.chart.throughput", helpKey: "throughput",
    data: { mode: "stats", metricName: "throughput", bucket: "", stats: ["count"] },
    chart: { type: "line", trendLine: true },
    series: [{ key: "count", label: "Issues livrées", color: "var(--c-count, #4dd697)" }],
    sprintKey: "throughput",
  },
  {
    id: "throughputWeightedChart", key: "throughputWeighted", tab: "delivery",
    titleKey: "report.chart.throughputWeighted", helpKey: "throughputWeighted",
    data: { mode: "stats", metricName: "throughput-weighted", bucket: "", stats: ["count", "estimatedDays"] },
    chart: { type: "line", trendLine: true },
    series: [{ key: "estimatedDays", label: "Jours-personnes", color: "var(--c-days, #a78bff)" }],
    showWhen: "showWeighted",
    sprintKey: "throughputWeighted",
  },
  {
    id: "wipChart", key: "wip", tab: "delivery",
    titleKey: "report.chart.wip", helpKey: "wip",
    data: { mode: "stats", metricName: "wip", bucket: "", stats: ["count"] },
    chart: { type: "line", trendLine: true },
    series: [{ key: "count", label: "WIP", color: "var(--c-days, #a78bff)" }],
  },
  {
    id: "bugThroughputChart", key: "bugThroughput", tab: "delivery",
    titleKey: "report.chart.bugThroughput", helpKey: "bugThroughput",
    data: { mode: "stats", metricName: "bug-throughput", bucket: "", stats: ["count"] },
    chart: { type: "line", trendLine: true },
    series: [{ key: "count", label: "Bugs", color: "#ef4444" }],
    sprintKey: "bugThroughput",
  },
  // ── Quality ───────────────────────────────────────────────────────────────
  {
    id: "bugCycleTimeChart", key: "bugCycleTime", tab: "quality",
    titleKey: "report.chart.bugCycleTime", helpKey: "bugCycleTime",
    data: { mode: "stats", metricName: "bug-cycle-time", bucket: "", stats: ["median", "p85"] },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "median", label: "Médiane", color: "var(--c-median, #00e0d4)" },
      { key: "p85",    label: "P85",     color: "var(--c-p85, #ff8a3d)"   },
    ],
  },
  {
    id: "cycleNormalizedChart", key: "cycleTimeNormalized", tab: "quality",
    titleKey: "report.chart.cycleNormalized", helpKey: "cycleTimeNormalized",
    data: { mode: "stats", metricName: "cycle-time-normalized", bucket: "", stats: ["median", "p85"] },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "median", label: "Médiane (ratio)", color: "var(--c-median, #00e0d4)" },
      { key: "p85",    label: "P85 (ratio)",     color: "var(--c-p85, #ff8a3d)"   },
    ],
  },
  {
    id: "leadNormalizedChart", key: "leadTimeNormalized", tab: "quality",
    titleKey: "report.chart.leadNormalized", helpKey: "leadTimeNormalized",
    data: { mode: "stats", metricName: "lead-time-normalized", bucket: "", stats: ["median", "p85"] },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "median", label: "Médiane (ratio)", color: "var(--c-median, #00e0d4)" },
      { key: "p85",    label: "P85 (ratio)",     color: "var(--c-p85, #ff8a3d)"   },
    ],
  },
  {
    id: "flowEfficiencyChart", key: "flowEfficiency", tab: "quality",
    titleKey: "report.chart.flowEfficiency", helpKey: "flowEfficiency",
    data: { mode: "stats", metricName: "flow-efficiency", bucket: "", stats: ["aggregate", "median"] },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "aggregate", label: "Agrégat (pondéré durée)", color: "var(--c-median, #00e0d4)" },
      { key: "median",    label: "Médiane (par issue)",     color: "var(--c-p85, #ff8a3d)"   },
    ],
  },
  {
    id: "cycleHistogramChart", key: "cycleHistogram", tab: "quality",
    titleKey: "report.chart.cycleHistogram", helpKey: "cycleHistogram",
    data: null,
    chart: { type: "custom", rendererId: "cycleHistogram" },
  },
  // leadBySize + cycleBySize : gérés par initBucketSelector, aucun renderer dans CUSTOM_RENDERERS → skip dispatcher
  {
    id: "leadBySizeChart", key: "leadBySize", tab: "quality",
    titleKey: "report.chart.leadBySize", helpKey: "leadTimeBySize",
    data: null,
    chart: { type: "custom", rendererId: "leadBySize" },
  },
  {
    id: "cycleBySizeChart", key: "cycleBySize", tab: "quality",
    titleKey: "report.chart.cycleBySize", helpKey: "cycleTimeBySize",
    data: null,
    chart: { type: "custom", rendererId: "cycleBySize" },
  },
  // ── Forecast ──────────────────────────────────────────────────────────────
  {
    id: "agingScatter", key: "agingWip", tab: "forecast",
    titleKey: "report.chart.agingWip", helpKey: "agingWip",
    data: null,
    chart: { type: "custom", rendererId: "agingScatter" },
  },
  // ── Roles ─────────────────────────────────────────────────────────────────
  {
    id: "wipPerRoleChart", key: "wipPerRole", tab: "roles",
    titleKey: "report.chart.wipPerRole", helpKey: "wipPerRole",
    data: { mode: "roleSeries", metricName: "wip-per-role", roles: ["dev", "qa", "po"], stat: "count" },
    chart: { type: "line" },
    series: [
      { key: "dev", label: "WIP dev", color: "var(--c-dev, #2563eb)" },
      { key: "qa",  label: "WIP qa",  color: "var(--c-qa,  #10b981)" },
      { key: "po",  label: "WIP po",  color: "var(--c-po,  #f59e0b)" },
    ],
  },
  {
    id: "ftrByRoleChart", key: "ftrByRole", tab: "roles",
    titleKey: "report.chart.ftrByRole", helpKey: "firstTimeRight",
    data: { mode: "roleSeries", metricName: "first-time-right", roles: ["dev", "qa", "po"], stat: "ftrRate" },
    chart: { type: "line", trendLine: true },
    series: [
      { key: "dev", label: "FTR dev", color: "var(--c-dev, #2563eb)" },
      { key: "qa",  label: "FTR qa",  color: "var(--c-qa,  #10b981)" },
      { key: "po",  label: "FTR po",  color: "var(--c-po,  #f59e0b)" },
    ],
    sprintKey: "ftrByRole",
  },
  {
    id: "reworkRatioChart", key: "handoffReworkRatio", tab: "roles",
    titleKey: "report.chart.reworkRatio", helpKey: "handoffRework",
    data: { mode: "stats", metricName: "handoff-rework", bucket: "", stats: ["reworkRatio", "avgReworks"] },
    chart: { type: "line", trendLine: true },
    series: [{ key: "reworkRatio", label: "Taux de rework", color: "#ef4444" }],
    sprintKey: "handoffReworkRatio",
  },
  {
    id: "reworkByTypeChart", key: "handoffReworkByType", tab: "roles",
    titleKey: "report.chart.reworkByType", helpKey: "handoffRework",
    data: { mode: "roleSeries", metricName: "handoff-rework", roles: ["qaToDev", "poToQa", "poDev"], stat: "count" },
    chart: { type: "bar" },
    series: [
      { key: "qaToDev", label: "QA→Dev", color: "#ef4444" },
      { key: "poToQa",  label: "PO→QA",  color: "#f97316" },
      { key: "poDev",   label: "PO→Dev", color: "#a855f7" },
    ],
    sprintKey: "handoffReworkByType",
  },
  {
    id: "reworkCostChart", key: "reworkCost", tab: "roles",
    titleKey: "report.chart.reworkCost", helpKey: "reworkCost",
    data: { mode: "stats", metricName: "rework-cost", bucket: "", stats: ["totalReworkDays", "reworkCostRatio", "reworkedCount"] },
    chart: { type: "line", trendLine: true },
    series: [{ key: "totalReworkDays", label: "Jours rework", color: "#ef4444" }],
    sprintKey: "reworkCost",
  },
  {
    id: "stageTimeByRoleChart", key: "stageTimeByRole", tab: "roles",
    titleKey: "report.chart.stageTimeByRole", helpKey: "stageTimeBreakdown",
    data: { mode: "roleSeries", metricName: "stage-time-breakdown", roles: ["dev", "qa", "po"], stat: "median" },
    chart: { type: "custom", rendererId: "stageTimeByRole" },
  },
  {
    id: "stageTimeShareChart", key: "stageTimeShare", tab: "roles",
    titleKey: "report.chart.stageTimeShare", helpKey: "stageTimeBreakdown",
    data: { mode: "roleSeries", metricName: "stage-time-breakdown", roles: ["dev", "qa", "po"], stat: "avgShare" },
    chart: { type: "custom", rendererId: "stageTimeShare" },
  },
  {
    id: "stageThroughputGapChart", key: "stageThroughputNet", tab: "roles",
    titleKey: "report.chart.stageThroughputGap", helpKey: "stageThroughputGap",
    data: { mode: "roleSeries", metricName: "stage-throughput-gap", roles: ["dev", "qa", "po"], stat: "avgNet" },
    chart: { type: "custom", rendererId: "stageThroughputGap" },
  },
  // ── Advanced ──────────────────────────────────────────────────────────────
  {
    id: "devTimeAllocationChart", key: "devTimeAllocation", tab: "advanced",
    titleKey: "report.chart.devTimeAllocation", helpKey: "devTimeAllocation",
    data: { mode: "stats", metricName: "dev-time-allocation", bucket: "", stats: ["featureDays", "bugDays", "bugRatio"] },
    chart: { type: "custom", rendererId: "devTimeAllocation" },
  },
  {
    id: "bugBacklogChart", key: "bugBacklog", tab: "advanced",
    titleKey: "report.chart.bugBacklog", helpKey: "bugBacklog",
    data: { mode: "stats", metricName: "bug-backlog", bucket: "", stats: ["openCount", "netFlow"] },
    chart: { type: "custom", rendererId: "bugBacklog" },
  },
  {
    id: "bottleneckScoresChart", key: "bottleneckScores", tab: "advanced",
    titleKey: "report.chart.bottleneckScores", helpKey: "bottleneckAnalysis",
    data: { mode: "roleSeries", metricName: "bottleneck-analysis", roles: ["dev", "qa", "po"], stat: "score" },
    chart: { type: "custom", rendererId: "bottleneckScores" },
  },
  {
    id: "agingWipRiskChart", key: "agingWipRisk", tab: "advanced",
    titleKey: "report.chart.agingWip", helpKey: "agingWip",
    data: { mode: "stats", metricName: "aging-wip", bucket: "", stats: ["ok", "watch", "atRisk", "critical"] },
    chart: { type: "bar" },
    series: [
      { key: "ok",       label: "OK",       color: "#10b981" },
      { key: "watch",    label: "Watch",    color: "#f59e0b" },
      { key: "atRisk",   label: "At risk",  color: "#f97316" },
      { key: "critical", label: "Critical", color: "#ef4444" },
    ],
  },
  // stageTimeByRoleP85 : données P85 pour renderStageTimeByRole — pas de canvas propre, renderer absent = skip dispatcher
  {
    id: "stageTimeByRoleP85Chart", key: "stageTimeByRoleP85", tab: "roles",
    titleKey: "report.chart.stageTimeByRole", helpKey: "stageTimeBreakdown",
    data: { mode: "roleSeries", metricName: "stage-time-breakdown", roles: ["dev", "qa", "po"], stat: "p85" },
    chart: { type: "custom", rendererId: "stageTimeByRoleP85" },
  },
];

export type TFn = (key: string) => string;

export function serializeChartDefs(defs: ChartDef[], t: TFn): string {
  const resolved: ChartDefResolved[] = defs.map(({ titleKey, ...rest }) => ({
    ...rest,
    title: t(titleKey),
  }));
  return JSON.stringify(resolved);
}

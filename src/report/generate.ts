import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import { BUCKET_LABELS, BUCKET_ORDER, percentile } from "../metrics/utils";
import { type MetricConfig, type EstimationConfig } from "../metrics/types";
import { agingWipMetric, type AgingWipSummary, type AgingWipIssue, type AgingRisk } from "../metrics/agingWip";
import { forecastMetric, type ForecastSummary } from "../metrics/forecast";
import { cycleTimeMetric } from "../metrics/cycleTime";
import { leadTimeMetric } from "../metrics/leadTime";
import { scopeChangeMetric, type ScopeChangeResult } from "../metrics/scopeChange";
import { bottleneckAnalysisMetric, type BottleneckAnalysisResult, type RoleKey } from "../metrics/bottleneckAnalysis";
import { throughputMetric } from "../metrics/throughput";
import { bugThroughputMetric } from "../metrics/bugThroughput";
import { throughputWeightedMetric } from "../metrics/throughputWeighted";
import { handoffReworkMetric } from "../metrics/handoffRework";
import { firstTimeRightMetric } from "../metrics/firstTimeRight";
import { reworkCostMetric } from "../metrics/reworkCost";
import { now } from "../clock";
import { t, getCurrentLocale, type LocaleShape, type LocaleCode } from "../i18n/index";
import { CHART_DEFS, serializeChartDefs, type ChartDef } from "./chartDefs";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import type { ReadStore, SprintRecord } from "../store/types";
import { buildMetricsContext, buildBaseMetricsContext, deriveMetricsContext } from "../metrics/context";

export function buildReportLabels(lang: LocaleCode): LocaleShape {
  return lang === "fr" ? fr : en;
}

const STALE_THRESHOLD_DAYS = 7;

export interface ReportPersonalization {
  title?: string;
  logoUrl?: string;
  fontUrl?: string;
  customCssPath?: string;
  excludeTabs?: string[];
  templatePath?: string;
}

export interface ResolvedPersonalization {
  title?: string;
  logoDataUri?: string;
  fontLinkHtml?: string;
  customCss?: string;
  excludedTabs: Set<string>;
}

const VALID_TABS = new Set(["delivery", "quality", "roles", "forecast", "advanced"]);

const ROLE_CSS_COLOR: Record<RoleKey, string> = {
  dev: "var(--violet)",
  qa:  "var(--green)",
  po:  "var(--orange)",
};
const LOGO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function resolvePersonalization(
  p: ReportPersonalization | undefined,
  boardDir: string,
): ResolvedPersonalization {
  if (!p) { return { excludedTabs: new Set() }; }

  let logoDataUri: string | undefined;
  if (p.logoUrl) {
    if (p.logoUrl.startsWith("data:")) {
      throw new Error(`[report] logoUrl ne peut pas commencer par "data:" — utiliser un chemin ou une URL http(s).`);
    }
    const isRemote = p.logoUrl.startsWith("http://") || p.logoUrl.startsWith("https://");
    if (isRemote) {
      logoDataUri = p.logoUrl;
    } else {
      const abs = path.resolve(boardDir, p.logoUrl);
      const ext = path.extname(abs).toLowerCase();
      const mime = LOGO_MIME[ext];
      if (!mime) {
        console.warn(`[report] Extension logo non reconnue : ${ext} — logo ignoré.`);
      } else if (!fs.existsSync(abs)) {
        throw new Error(`[report] logoUrl introuvable : ${abs}`);
      } else {
        logoDataUri = `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
      }
    }
  }

  let customCss: string | undefined;
  if (p.customCssPath) {
    const abs = path.resolve(boardDir, p.customCssPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`[report] customCssPath introuvable : ${abs}`);
    }
    customCss = fs.readFileSync(abs, "utf-8");
  }

  const fontLinkHtml = p.fontUrl
    ? `<link href="${p.fontUrl}" rel="stylesheet">`
    : undefined;

  const excludedTabs = new Set<string>();
  for (const t of p.excludeTabs ?? []) {
    if (VALID_TABS.has(t)) { excludedTabs.add(t); }
    else { console.warn(`[report] excludeTabs: onglet inconnu "${t}" ignoré.`); }
  }

  return { title: p.title, logoDataUri, fontLinkHtml, customCss, excludedTabs };
}

export interface EstimationFlags {
  showWeighted: boolean;
  showNormalized: boolean;
  showBySize: boolean;
  weightedUnit: "j-h" | "SP" | "pts";
  contextLabel: string;
}

export function estimationFlags(est: EstimationConfig): EstimationFlags {
  const m = est.method;
  const thr = { xs: 1, s: 3, m: 8, l: 13, ...est.bucketThresholds };
  return {
    showWeighted:       m !== "t-shirt" && m !== "none",
    showNormalized:     m === "time",
    showBySize:         m !== "none",
    weightedUnit:       m === "story-points" ? "SP" : m === "numeric" ? "pts" : "j-h",
    contextLabel:
      m === "time"          ? t("report.estimation.time")
      : m === "story-points" ? t("report.estimation.storyPoints", { xs: String(thr.xs), s: String(thr.s), m: String(thr.m), l: String(thr.l) })
      : m === "numeric"      ? t("report.estimation.numeric")
      : m === "t-shirt"      ? t("report.estimation.tShirt")
      : t("report.estimation.none"),
  };
}

function hide(show: boolean): string { return show ? "" : ' style="display:none"'; }

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

export type HealthSignal = "green" | "orange" | "red" | "none";

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

const MS_PER_DAY = 86_400_000;

interface SnapshotRow {
  snapshot_date: string;
  metric_name: string;
  bucket: string;
  stat: string;
  value: number;
}

export interface SprintChartSeries {
  labels: string[];
  series: Record<string, number[]>;
  hasActiveSprint: boolean;
}

interface SprintRow { name: string; state: string; start_date: string; end_date: string | null }

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

interface BucketStats {
  count: number;
  median: number;
  p85: number;
}

interface ChartSeries {
  dates: string[];
  series: Record<string, number[]>;
}



export function generateReport(
  store: ReadStore,
  projectKey: string,
  jiraBaseUrl: string,
  outputPath: string,
  config: MetricConfig,
  healthThresholds?: HealthThresholds,
  squadName?: string,
  personalization?: ReportPersonalization,
  boardDir?: string,
): void {
  // pourquoi : ticket 050 — conversion à la frontière camelCase → snake_case
  // pour préserver le type interne SnapshotRow utilisé dans tout le fichier.
  const snapshots: SnapshotRow[] = store.snapshots.all().map((s) => ({
    snapshot_date: s.snapshotDate,
    metric_name: s.metricName,
    bucket: s.bucket,
    stat: s.stat,
    value: s.value,
  }));

  if (snapshots.length === 0) {
    throw new Error("Aucun snapshot. Lancer `npm run snapshots` d'abord.");
  }

  // pourquoi : ticket 050 — reproduit le filtre/tri SQL d'origine (start_date non null,
  // end_date null ou >= cutoffDate, ORDER BY start_date ASC) sur SprintRecord[] camelCase.
  // Si cutoffDate est undefined, la comparaison SQL `end_date >= NULL` retournait toujours faux ;
  // on reproduit ce comportement en exigeant explicitement un cutoffDate non vide.
  const cutoffDate = config.cutoffDate;
  const sprintRows: SprintRow[] = store.sprints.all()
    .filter((s): s is SprintRecord & { startDate: string } => s.startDate !== null
      && (s.endDate === null || (cutoffDate !== undefined && s.endDate >= cutoffDate)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((s) => ({
      name: s.name,
      state: s.state,
      start_date: s.startDate,
      end_date: s.endDate,
    }));
  const sprintCharts = sprintRows.length > 0
    ? buildSprintSeries(store, config, sprintRows)
    : null;
  const rolesSprintCharts = sprintRows.length > 0
    ? buildRolesSprintSeries(store, config, sprintRows)
    : null;

  // Pré-grouper par metric_name pour un parcours O(N) au lieu de O(N×M).
  const byMetric = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const arr = byMetric.get(s.metric_name);
    if (arr) {arr.push(s);}
    else {byMetric.set(s.metric_name, [s]);}
  }
  const metricRows = (name: string): SnapshotRow[] => byMetric.get(name) ?? [];

  const charts = buildAllChartData(metricRows, CHART_DEFS);

  const lastDate = snapshots[snapshots.length - 1].snapshot_date;
  const latestRows = snapshots.filter((s) => s.snapshot_date === lastDate);

  const kpis = {
    leadTimeMedian: pickValue(latestRows, "lead-time", "", "median"),
    cycleTimeMedian: pickValue(latestRows, "cycle-time", "", "median"),
    throughputCount: pickValue(latestRows, "throughput", "", "count"),
    wipCount: pickValue(latestRows, "wip", "", "count"),
    bugThroughputCount: pickValue(latestRows, "bug-throughput", "", "count"),
    bugCycleTimeMedian: pickValue(latestRows, "bug-cycle-time", "", "median"),
    flowEfficiencyAggregate: pickValue(latestRows, "flow-efficiency", "", "aggregate"),
    devTimeAvgBugRatio: pickValue(latestRows, "dev-time-allocation", "", "bugRatio"),
    stageTimeDevMedian: pickValue(latestRows, "stage-time-breakdown", "dev", "median"),
    stageTimeQaMedian:  pickValue(latestRows, "stage-time-breakdown", "qa",  "median"),
    stageTimePoMedian:  pickValue(latestRows, "stage-time-breakdown", "po",  "median"),
    wipDev: pickValue(latestRows, "wip-per-role", "dev", "count"),
    wipQa:  pickValue(latestRows, "wip-per-role", "qa",  "count"),
    wipPo:  pickValue(latestRows, "wip-per-role", "po",  "count"),
    reworkRatio: pickValue(latestRows, "handoff-rework", "", "reworkRatio"),
    avgReworks:  pickValue(latestRows, "handoff-rework", "", "avgReworks"),
    ftrDev: pickValue(latestRows, "first-time-right", "dev", "ftrRate"),
    ftrQa:  pickValue(latestRows, "first-time-right", "qa",  "ftrRate"),
    ftrPo:  pickValue(latestRows, "first-time-right", "po",  "ftrRate"),
    reworkTotalDays:  pickValue(latestRows, "rework-cost", "", "totalReworkDays"),
    reworkCostRatio:  pickValue(latestRows, "rework-cost", "", "reworkCostRatio"),
  };

  const leadBySize = latestBySize(latestRows.filter((r) => r.metric_name === "lead-time-by-size"));
  const cycleBySize = latestBySize(latestRows.filter((r) => r.metric_name === "cycle-time-by-size"));

  const leadBySizeRows = metricRows("lead-time-by-size");
  const cycleBySizeRows = metricRows("cycle-time-by-size");
  const leadTimeBySizeCharts: Record<string, ChartSeries> = {};
  const cycleTimeBySizeCharts: Record<string, ChartSeries> = {};
  for (const b of BUCKET_ORDER) {
    const lead = buildBucketSeries(leadBySizeRows, b, ["median", "p85", "p95", "count"]);
    if (lead.dates.length > 0) {leadTimeBySizeCharts[b] = lead;}
    const cycle = buildBucketSeries(cycleBySizeRows, b, ["median", "p85", "p95", "count"]);
    if (cycle.dates.length > 0) {cycleTimeBySizeCharts[b] = cycle;}
  }
  const lastSyncAt = store.syncLog.lastByProject(projectKey)?.syncedAt ?? null;
  const isSyncStale = lastSyncAt === null
    || (Date.now() - new Date(lastSyncAt).getTime()) > STALE_THRESHOLD_DAYS * MS_PER_DAY;

  const liveCtx = buildMetricsContext(store, config);
  const agingWip = agingWipMetric.compute(liveCtx);
  const forecast = forecastMetric.compute(liveCtx);
  const bottleneck = bottleneckAnalysisMetric.compute(liveCtx);
  const cycleTime = cycleTimeMetric.compute(liveCtx);
  const histogram = buildHistogram(cycleTime.issues.map((i) => i.cycleTimeDays));

  // pourquoi : ticket 050 — table issue_field_changes toujours créée par schema.sql ;
  // l'ancien feature gate isScopeChangeAvailable() est devenu inutile.
  const scopeData = scopeChangeMetric.compute(liveCtx);
  const scopeAlertHtml = buildScopeAlertBanner(store, scopeData);
  const scopeSectionHtml = buildScopeSection(scopeData, store, jiraBaseUrl);

  const resolvedPersonalization = resolvePersonalization(personalization, boardDir ?? process.cwd());

  const renderInput: RenderInput = {
    projectKey,
    squadName,
    jiraBaseUrl,
    generatedAt: now().toISOString().slice(0, 19).replace("T", " "),
    lastSnapshotDate: lastDate,
    lastSyncAt,
    isSyncStale,
    kpis,
    charts,
    leadBySize,
    cycleBySize,
    leadTimeBySizeCharts,
    cycleTimeBySizeCharts,
    agingWip,
    forecast,
    histogram,
    cycleStats: {
      median: cycleTime.medianDays,
      p85: cycleTime.p85Days,
      p95: cycleTime.p95Days,
      avg: cycleTime.avgDays,
      count: cycleTime.count,
    },
    healthThresholds: resolveThresholds(healthThresholds, snapshots),
    scopeAlertHtml,
    scopeSectionHtml,
    personalization: resolvedPersonalization,
    estimation: config.estimation,
    bottleneck,
    sprintCharts,
    rolesSprintCharts,
  };

  const resolvedTemplatePath = personalization?.templatePath
    ? path.resolve(boardDir ?? process.cwd(), personalization.templatePath)
    : path.join(__dirname, "templates", "report.hbs");

  const html = renderWithHandlebars(renderInput, resolvedTemplatePath);

  fs.writeFileSync(outputPath, html);
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

function pickValue(rows: SnapshotRow[], metric: string, bucket: string, stat: string): number | null {
  const r = rows.find((x) => x.metric_name === metric && x.bucket === bucket && x.stat === stat);
  return r ? r.value : null;
}

function latestBySize(rows: SnapshotRow[]): Partial<Record<string, BucketStats>> {
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

interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

interface RenderInput {
  projectKey: string;
  squadName?: string;
  jiraBaseUrl: string;
  generatedAt: string;
  lastSnapshotDate: string;
  lastSyncAt: string | null;
  isSyncStale: boolean;
  kpis: Record<string, number | null>;
  charts: Record<string, ChartSeries>;
  leadBySize: Partial<Record<string, BucketStats>>;
  cycleBySize: Partial<Record<string, BucketStats>>;
  leadTimeBySizeCharts: Record<string, ChartSeries>;
  cycleTimeBySizeCharts: Record<string, ChartSeries>;
  agingWip: AgingWipSummary;
  forecast: ForecastSummary;
  histogram: HistogramBin[];
  cycleStats: { median: number; p85: number; p95: number; avg: number; count: number };
  healthThresholds?: HealthThresholds;
  scopeAlertHtml?: string;
  scopeSectionHtml?: string;
  personalization?: ResolvedPersonalization;
  estimation?: EstimationConfig;
  bottleneck: BottleneckAnalysisResult;
  sprintCharts: {
    throughput: SprintChartSeries;
    bugThroughput: SprintChartSeries;
    throughputWeighted: SprintChartSeries;
    leadTime: SprintChartSeries;
    cycleTime: SprintChartSeries;
  } | null;
  rolesSprintCharts: {
    ftrByRole: SprintChartSeries;
    handoffReworkRatio: SprintChartSeries;
    handoffReworkByType: SprintChartSeries;
    reworkCost: SprintChartSeries;
  } | null;
}

function buildHistogram(values: number[]): HistogramBin[] {
  if (values.length === 0) {return [];}
  const sorted = [...values].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1];
  // Largeur de bin entière au-dessus de 1, sinon 0.5. Pour distributions courtes
  // on préfère une granularité fine.
  const binWidth = max <= 5 ? 0.5 : max <= 20 ? 1 : Math.ceil(max / 20);
  const binCount = Math.ceil((max + 0.0001) / binWidth);
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({ start: i * binWidth, end: (i + 1) * binWidth, count: 0 });
  }
  for (const v of sorted) {
    const idx = Math.min(bins.length - 1, Math.floor(v / binWidth));
    bins[idx].count++;
  }
  return bins;
}

// ─── Helpers HTML utilisés par buildRenderedTabs() ───────────────────────────

function fmtInt(v: number | null): string {
  return v === null ? "—" : String(Math.round(v));
}

function bySizeRows(data: Partial<Record<string, BucketStats>>): string {
  return BUCKET_ORDER.map((b) => {
    const s = data[b];
    if (!s || s.count === 0) {return "";}
    return `<tr><td>${escapeHtml(BUCKET_LABELS[b])}</td><td>${s.count}</td><td>${s.median.toFixed(1)}j</td><td>${s.p85.toFixed(1)}j</td></tr>`;
  }).join("");
}

function forecastTableRows(data: ForecastSummary): string {
  if (data.byHorizon.length === 0) {
    return `<tr><td colspan="5">${escapeHtml(t("report.forecast.noThroughput"))}</td></tr>`;
  }
  return data.byHorizon
    .map(
      (h) =>
        `<tr><td>${h.weeks} ${escapeHtml(t("report.forecast.weeks"))}</td><td><strong>${h.p15.toFixed(0)}</strong></td><td>${h.p50.toFixed(0)}</td><td>${h.p85.toFixed(0)}</td><td>${h.p95.toFixed(0)}</td></tr>`,
    )
    .join("");
}

function helpBtn(key: string): string {
  const titleKey = `report.help.${key}.title` as keyof LocaleShape;
  const bodyKey = `report.help.${key}.body` as keyof LocaleShape;
  const title = t(titleKey);
  if (!title) {return "";}
  return `<span class="help-wrap"><button class="help-btn" aria-label="${escapeHtml(t("report.help.btn"))}">?</button><span class="help-popover" role="tooltip"><strong>${escapeHtml(title)}</strong>${escapeHtml(t(bodyKey))}</span></span>`;
}

// pourquoi: data-values est lu côté client par renderSparklines() ; JSON est ASCII-safe pour des nombres,
// escapeHtml encode les guillemets pour rester valide dans un attribut entre apostrophes.
function renderKpiCellHtml(c: KpiCell, idx: number): string {
  const help = c.helpKey ? helpBtn(c.helpKey) : "";
  const unit = c.value !== null && c.unit ? `<span class="unit">${escapeHtml(c.unit)}</span>` : "";
  const sparkData = JSON.stringify(c.spark);
  return `<div class="kpi-cell ${SIGNAL_CLS[c.signal]}">
      <div class="kpi-label">${escapeHtml(c.label)}${help}</div>
      <div class="kpi-value">${escapeHtml(formatKpiNumber(c.value))}${unit}</div>
      ${fmtDelta(c)}
      <canvas class="spark" id="kpi-spark-${idx}" width="180" height="52" data-values='${escapeHtml(sparkData)}' data-color="${SIGNAL_COLOR[c.signal]}"></canvas>
    </div>`;
}

function buildBottleneckPanelHtml(b: BottleneckAnalysisResult): string {
  if (b.count === 0) {
    return `<div class="chart-card wide"><h3>Bottleneck Analysis${helpBtn("bottleneckAnalysis")}</h3><p class="meta-line">${escapeHtml(t("report.bottleneck.noData"))}</p></div>`;
  }
  const primary = b.primaryBottleneck ?? "dev";
  const score = b.byRole[primary].score;
  const badgeCls = score >= 0.6 ? "risk-critical" : score >= 0.4 ? "risk-at-risk" : "risk-ok";
  const colLabel = b.primaryColumn ? ` (${escapeHtml(b.primaryColumn)})` : "";
  const bars = (["dev", "qa", "po"] as const).map((role) => {
    const s = b.byRole[role];
    const pct = Math.round(s.score * 100);
    const fillColor = s.score >= 0.6 ? "var(--red)" : s.score >= 0.4 ? "var(--orange)" : "var(--green)";
    const labelCls = s.score >= 0.6 ? "risk-critical" : s.score >= 0.4 ? "risk-at-risk" : "risk-ok";
    return `<div class="bn-row">
        <span class="bn-label ${labelCls}">${escapeHtml(role.toUpperCase())} <span class="bn-rank">#${s.rank}</span></span>
        <div class="bn-bar-bg"><div class="bn-bar-fill" style="width:${pct}%;background:${fillColor}"></div></div>
        <span class="bn-pct mono">${pct}%</span>
      </div>`;
  }).join("");
  return `<div class="chart-card wide">
    <h3>Bottleneck Analysis${helpBtn("bottleneckAnalysis")}</h3>
    <p class="meta-line"><span class="${badgeCls}">${escapeHtml(primary.toUpperCase())}${colLabel}</span> — ${escapeHtml(b.recommendation)}</p>
    <div class="bn-bars">${bars}</div>
  </div>`;
}

function buildColumnDrilldownHtml(b: BottleneckAnalysisResult): string {
  if (b.byColumn.length === 0) {return "";}
  const maxMedian = Math.max(...b.byColumn.map((c) => c.medianDays));
  const rows = b.byColumn.map((c) => {
    const pct = maxMedian > 0 ? Math.max(1, Math.round((c.medianDays / maxMedian) * 100)) : 1;
    const color = ROLE_CSS_COLOR[c.role];
    return `<div class="bn-row">
        <span class="bn-label">${escapeHtml(c.column)} <span class="bn-rank">${escapeHtml(c.role.toUpperCase())}</span></span>
        <div class="bn-bar-bg"><div class="bn-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="bn-pct mono">${c.medianDays.toFixed(1)}j <span class="bn-rank">(${c.count})</span></span>
      </div>`;
  }).join("");
  return `<div class="chart-card" style="margin-bottom: 1rem">
    <h3>${escapeHtml(t("report.chart.columnDrilldown"))}${helpBtn("bottleneckAnalysis")}</h3>
    <div class="bn-bars bn-bars-col">${rows}</div>
  </div>`;
}

function renderRoleCardHtml(r: { cls: string; name: string; wip: number | null; med: number | null; ftr: number | null }): string {
  return `<div class="role ${r.cls}">
      <h4>${escapeHtml(r.name)}</h4>
      <div class="role-stats">
        <div class="role-stat"><div class="v">${fmtInt(r.wip)}</div><div class="l">WIP</div></div>
        <div class="role-stat"><div class="v">${r.med === null ? "—" : `${r.med.toFixed(1)}j`}</div><div class="l">${escapeHtml(t("report.role.median"))}</div></div>
        <div class="role-stat"><div class="v">${r.ftr === null ? "—" : `${(r.ftr * 100).toFixed(0)}%`}</div><div class="l">${escapeHtml(t("report.role.ftr"))}</div></div>
      </div>
    </div>`;
}

// ─── Fonctions Handlebars / buildTemplateContext ───────────────────────────────

function buildKpiCellsFromInput(input: RenderInput): KpiCell[] {
  const thresholds = input.healthThresholds;
  const rawSignals: KpiSignals = {
    leadTime: evalLowerBetter(input.kpis.leadTimeMedian, thresholds?.leadTimeMedianDays),
    cycleTime: evalLowerBetter(input.kpis.cycleTimeMedian, thresholds?.cycleTimeMedianDays),
    throughput: evalHigherBetter(input.kpis.throughputCount, thresholds?.throughputWeekly),
    wip: evalLowerBetter(input.kpis.wipCount, thresholds?.wipCount),
    bugCycle: evalLowerBetter(input.kpis.bugCycleTimeMedian, thresholds?.bugCycleTimeMedianDays),
    bugRatio: evalLowerBetter(input.kpis.devTimeAvgBugRatio, thresholds?.bugRatio),
  };
  return buildKpiCells(input.charts, input.agingWip, rawSignals);
}

function buildVerdictHtml(input: RenderInput): string {
  const verdict = computeVerdict(buildKpiCellsFromInput(input));
  return `<div class="verdict ${verdict.status}">
  <span class="verdict-status">${escapeHtml(verdictLabels()[verdict.status])}</span>
  <span class="verdict-text">${verdict.phrase}</span>
  <span class="verdict-time mono">${escapeHtml(syncMetaLabel(input.lastSyncAt))} · Snapshot ${escapeHtml(input.lastSnapshotDate)}</span>
</div>`;
}

export function buildKpiGridHtml(input: RenderInput): string {
  return buildKpiCellsFromInput(input).map(renderKpiCellHtml).join("");
}

export function buildRenderedTabs(input: RenderInput): { id: string; label: string; html: string }[] {
  const flags = estimationFlags(input.estimation ?? { method: "time" });
  const tabs: { id: string; label: string; html: string }[] = [];

  tabs.push({
    id: "delivery",
    label: t("report.tab.delivery"),
    html: `<div class="panel-grid">
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.leadTime"))}${helpBtn("leadTime")}</h3><div class="chart-wrap"><canvas id="leadTimeChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.cycleTime"))}${helpBtn("cycleTime")}</h3><div class="chart-wrap"><canvas id="cycleTimeChart"></canvas></div></div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card"><h3><span class="chart-title-text" id="throughputChartTitle">${escapeHtml(t("report.chart.throughput"))}</span>${helpBtn("throughput")}</h3><div class="chart-wrap"><canvas id="throughputChart"></canvas></div></div>
    <div class="chart-card"${hide(flags.showWeighted)}><h3><span class="chart-title-text" id="throughputWeightedChartTitle">${escapeHtml(t("report.chart.throughputWeighted", { unit: flags.weightedUnit }))}</span>${helpBtn("throughputWeighted")}</h3><div class="chart-wrap"><canvas id="throughputWeightedChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.wip"))}${helpBtn("wip")}</h3><div class="chart-wrap"><canvas id="wipChart"></canvas></div></div>
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.cycleHistogram"))}${helpBtn("cycleHistogram")}</h3>
      <p class="meta-line">${escapeHtml(t("report.meta.cycleStats", { count: String(input.cycleStats.count), median: input.cycleStats.median.toFixed(1), p85: input.cycleStats.p85.toFixed(1), p95: input.cycleStats.p95.toFixed(1), avg: input.cycleStats.avg.toFixed(1) }))}</p>
      <div class="chart-wrap"><canvas id="cycleHistogramChart"></canvas></div>
    </div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.leadBySize", { date: input.lastSnapshotDate }))}${helpBtn("leadTimeBySize")}</h3>
      <table><thead><tr><th>${escapeHtml(t("report.table.size"))}</th><th>${escapeHtml(t("report.table.count"))}</th><th>${escapeHtml(t("report.table.median"))}</th><th>${escapeHtml(t("report.table.p85"))}</th></tr></thead>
      <tbody>${bySizeRows(input.leadBySize)}</tbody></table>
    </div>
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.cycleBySize"))}${helpBtn("cycleTimeBySize")}</h3>
      <table><thead><tr><th>${escapeHtml(t("report.table.size"))}</th><th>${escapeHtml(t("report.table.count"))}</th><th>${escapeHtml(t("report.table.median"))}</th><th>${escapeHtml(t("report.table.p85"))}</th></tr></thead>
      <tbody>${bySizeRows(input.cycleBySize)}</tbody></table>
    </div>
  </div>`,
  });

  tabs.push({
    id: "quality",
    label: t("report.tab.quality"),
    html: `<div class="panel-grid">
    <div class="chart-card"><h3><span class="chart-title-text" id="bugThroughputChartTitle">${escapeHtml(t("report.chart.bugThroughput"))}</span>${helpBtn("bugThroughput")}</h3><div class="chart-wrap"><canvas id="bugThroughputChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.bugCycleTime"))}${helpBtn("bugCycleTime")}</h3><div class="chart-wrap"><canvas id="bugCycleTimeChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.devTimeAllocation"))}${helpBtn("devTimeAllocation")}</h3><div class="chart-wrap"><canvas id="devTimeAllocationChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.bugBacklog"))}${helpBtn("bugBacklog")}</h3><div class="chart-wrap"><canvas id="bugBacklogChart"></canvas></div></div>
  </div>`,
  });

  tabs.push({
    id: "roles",
    label: t("report.tab.roles"),
    html: `<div class="role-grid">
    ${renderRoleCardHtml({ cls: "dev", name: "Dev", wip: input.kpis.wipDev, med: input.kpis.stageTimeDevMedian, ftr: input.kpis.ftrDev })}
    ${renderRoleCardHtml({ cls: "qa",  name: "QA",  wip: input.kpis.wipQa, med: input.kpis.stageTimeQaMedian, ftr: input.kpis.ftrQa })}
    ${renderRoleCardHtml({ cls: "po",  name: "PO",  wip: input.kpis.wipPo, med: input.kpis.stageTimePoMedian, ftr: input.kpis.ftrPo })}
  </div>
  ${buildBottleneckPanelHtml(input.bottleneck)}
  ${buildColumnDrilldownHtml(input.bottleneck)}
  <div class="panel-grid">
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.stageTimeByRole"))}${helpBtn("stageTimeBreakdown")}</h3><div class="chart-wrap"><canvas id="stageTimeByRoleChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.stageTimeShare"))}${helpBtn("stageTimeBreakdown")}</h3><div class="chart-wrap"><canvas id="stageTimeShareChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.wipPerRole"))}${helpBtn("wipPerRole")}</h3><div class="chart-wrap"><canvas id="wipPerRoleChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.stageThroughputGap"))}${helpBtn("stageThroughputGap")}</h3><div class="chart-wrap"><canvas id="stageThroughputGapChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.ftrByRole"))}${helpBtn("firstTimeRight")}</h3><div class="chart-wrap"><canvas id="ftrByRoleChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.reworkRatio"))}${helpBtn("handoffRework")}</h3><div class="chart-wrap"><canvas id="reworkRatioChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.reworkByType"))}${helpBtn("handoffRework")}</h3><div class="chart-wrap"><canvas id="reworkByTypeChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.bottleneckScores"))}${helpBtn("bottleneckAnalysis")}</h3><div class="chart-wrap"><canvas id="bottleneckScoresChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.reworkCost"))}${helpBtn("reworkCost")}</h3><div class="chart-wrap"><canvas id="reworkCostChart"></canvas></div></div>
  </div>`,
  });

  tabs.push({
    id: "forecast",
    label: t("report.tab.forecast"),
    html: `<div class="panel-grid">
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.forecastMonteCarlo"))}${helpBtn("forecast")}</h3>
      <p class="meta-line">${escapeHtml(t("report.meta.forecastPool", { weeks: String(input.forecast.weeksUsed), sims: String(input.forecast.simulations) }))}</p>
      <table>
        <thead><tr><th>Horizon</th><th>P15<br><small>(85% conf.)</small></th><th>P50</th><th>P85</th><th>P95</th></tr></thead>
        <tbody>${forecastTableRows(input.forecast)}</tbody>
      </table>
    </div>
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.agingWip", { date: input.agingWip.asOf }))}${helpBtn("agingWip")}</h3>
      <p class="meta-line">${escapeHtml(t("report.meta.agingStats", { p50: input.agingWip.percentiles.p50.toFixed(1), p85: input.agingWip.percentiles.p85.toFixed(1), p95: input.agingWip.percentiles.p95.toFixed(1), count: String(input.agingWip.count) }))}</p>
      <div class="chart-wrap"><canvas id="agingScatter"></canvas></div>
    </div>
    <div class="chart-card wide">
      <h3>${escapeHtml(t("report.chart.agingTopItems"))}${helpBtn("agingWip")}</h3>
      <table>
        <thead><tr><th>${escapeHtml(t("report.aging.col.issue"))}</th><th>${escapeHtml(t("report.aging.col.status"))}</th><th>${escapeHtml(t("report.aging.col.age"))}</th><th>${escapeHtml(t("report.aging.col.risk"))}</th></tr></thead>
        <tbody>${agingRowsHtml(input.agingWip, input.jiraBaseUrl)}</tbody>
      </table>
    </div>
  </div>`,
  });

  if (input.scopeSectionHtml) {
    tabs.push({ id: "scope", label: t("report.tab.scope"), html: input.scopeSectionHtml });
  }

  tabs.push({
    id: "advanced",
    label: t("report.tab.advanced"),
    html: `<div class="panel-grid three">
    <div class="chart-card"${hide(flags.showNormalized)}><h3>${escapeHtml(t("report.chart.leadNormalized"))}${helpBtn("leadTimeNormalized")}</h3><div class="chart-wrap"><canvas id="leadNormalizedChart"></canvas></div></div>
    <div class="chart-card"${hide(flags.showNormalized)}><h3>${escapeHtml(t("report.chart.cycleNormalized"))}${helpBtn("cycleTimeNormalized")}</h3><div class="chart-wrap"><canvas id="cycleNormalizedChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.flowEfficiency"))}${helpBtn("flowEfficiency")}</h3><div class="chart-wrap"><canvas id="flowEfficiencyChart"></canvas></div></div>
  </div>
  ${flags.showNormalized ? `<p class="estimation-note">${escapeHtml(t("report.estimation.note"))}</p>` : ""}
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.leadBySizeAdv"))}${helpBtn("leadTimeBySize")}</h3>
      <div class="bucket-selector" id="leadBySizeBuckets"></div>
      <div class="chart-wrap"><canvas id="leadBySizeChart"></canvas></div>
    </div>
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.cycleBySizeAdv"))}${helpBtn("cycleTimeBySize")}</h3>
      <div class="bucket-selector" id="cycleBySizeBuckets"></div>
      <div class="chart-wrap"><canvas id="cycleBySizeChart"></canvas></div>
    </div>
  </div>`,
  });

  return tabs;
}

export function buildChartDataJson(input: RenderInput): string {
  return JSON.stringify({
    charts: input.charts,
    histogram: input.histogram,
    cycleStats: input.cycleStats,
    aging: { issues: input.agingWip.issues, percentiles: input.agingWip.percentiles },
    leadBySize: input.leadTimeBySizeCharts,
    cycleBySize: input.cycleTimeBySizeCharts,
  });
}

export interface TemplateContext {
  projectKey: string;
  title: string;
  generatedAt: string;
  lastSnapshotDate: string;
  isSyncStale: boolean;
  lastSyncAt: string | null;
  htmlLang: string;
  headerSyncLabelSuffix: string;
  staleBannerHtml: string;
  scopeAlertHtml: string;
  estimationContextHtml: string;
  verdictHtml: string;
  top3Html: string;
  sectionToProcessLabel: string;
  sectionKpisLabel: string;
  kpiGridHtml: string;
  headerLogoHtml: string;
  fontLinkHtml: string;
  customStyleHtml: string;
  tabs: { id: string; label: string; html: string; active: boolean }[];
  kpis: Record<string, number | null>;
  chartDataJson: string;
  sprintChartsJson: string;
  sprintChartTitlesJson: string;
  hasSprintCharts: boolean;
  rolesSprintChartsJson: string;
  agingWip: AgingWipSummary;
  forecast: ForecastSummary;
  cycleStats: { median: number; p85: number; p95: number; avg: number; count: number };
  chartDefsJson: string;
  estimationFlagsJson: string;
}

const DEFAULT_FONT_LINK = `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

export function buildTemplateContext(
  input: RenderInput,
  renderedTabs: { id: string; label: string; html: string }[],
  chartDataJson: string,
): TemplateContext {
  const p = input.personalization;
  const excludedTabs = p?.excludedTabs ?? new Set<string>();
  const filteredTabs = renderedTabs.filter((t) => !excludedTabs.has(t.id));
  const firstId = filteredTabs[0]?.id ?? "";
  return {
    projectKey: input.projectKey,
    title: p?.title ?? t("report.title.default", { projectKey: input.projectKey }),
    generatedAt: input.generatedAt,
    lastSnapshotDate: input.lastSnapshotDate,
    isSyncStale: input.isSyncStale,
    lastSyncAt: input.lastSyncAt,
    htmlLang: getCurrentLocale(),
    headerSyncLabelSuffix: input.lastSyncAt ? ` · ${syncMetaLabel(input.lastSyncAt)}` : "",
    staleBannerHtml: staleBannerHtml(input.isSyncStale, input.lastSyncAt),
    scopeAlertHtml: input.scopeAlertHtml ?? "",
    estimationContextHtml: `<p class="estimation-context">${escapeHtml(estimationFlags(input.estimation ?? { method: "time" }).contextLabel)}</p>`,
    verdictHtml: buildVerdictHtml(input),
    top3Html: buildTop3Actions(input.agingWip, input.jiraBaseUrl),
    sectionToProcessLabel: t("report.section.toProcess"),
    sectionKpisLabel: t("report.section.kpis"),
    kpiGridHtml: buildKpiGridHtml(input),
    headerLogoHtml: p?.logoDataUri
      ? `<img src="${p.logoDataUri}" alt="logo" style="height:28px;vertical-align:middle;margin-right:.5rem;">`
      : "",
    fontLinkHtml: p?.fontLinkHtml ?? DEFAULT_FONT_LINK,
    customStyleHtml: p?.customCss ? `<style>\n${p.customCss}\n</style>` : "",
    tabs: filteredTabs.map((t) => ({ ...t, active: t.id === firstId })),
    kpis: input.kpis,
    chartDataJson,
    sprintChartsJson: input.sprintCharts !== null ? JSON.stringify(input.sprintCharts) : "null",
    sprintChartTitlesJson: JSON.stringify({
      throughput:        t("report.chart.throughput.sprint"),
      throughputWeighted: t("report.chart.throughputWeighted.sprint", { unit: estimationFlags(input.estimation ?? { method: "time" }).weightedUnit }),
      bugThroughput:     t("report.chart.bugThroughput.sprint"),
    }),
    hasSprintCharts: input.sprintCharts !== null,
    rolesSprintChartsJson: input.rolesSprintCharts !== null ? JSON.stringify(input.rolesSprintCharts) : "null",
    agingWip: input.agingWip,
    forecast: input.forecast,
    cycleStats: input.cycleStats,
    chartDefsJson: serializeChartDefs(CHART_DEFS, (k) => t(k as keyof LocaleShape)),
    estimationFlagsJson: JSON.stringify(estimationFlags(input.estimation ?? { method: "time" })),
  };
}

let _helpersRegistered = false;
function registerHelpers(): void {
  if (_helpersRegistered) {return;}
  _helpersRegistered = true;
  Handlebars.registerHelper("escapeHtml", (s: unknown) => escapeHtml((s as string | null | undefined) ?? ""));
  Handlebars.registerHelper("json", (v: unknown) => new Handlebars.SafeString(JSON.stringify(v)));
  Handlebars.registerHelper("fmt_float", (v: unknown, d: unknown) => {
    const num = v as number | null;
    if (num == null) {return "—";}
    return num.toFixed(typeof d === "number" ? d : 1);
  });
  Handlebars.registerHelper("if_includes", function(
    this: unknown,
    arr: string[],
    val: string,
    options: Handlebars.HelperOptions,
  ) {
    return arr.includes(val) ? options.fn(this) : options.inverse(this);
  });
}

export function renderWithHandlebars(input: RenderInput, templatePath: string): string {
  registerHelpers();
  let src: string;
  try {
    src = fs.readFileSync(templatePath, "utf-8");
  } catch {
    throw new Error(`[report] Template Handlebars introuvable : ${templatePath}`);
  }
  let compiled: Handlebars.TemplateDelegate;
  try {
    compiled = Handlebars.compile(src, { strict: false });
  } catch (e) {
    throw new Error(`[report] Erreur de compilation du template Handlebars : ${(e as Error).message}`);
  }
  const renderedTabs = buildRenderedTabs(input);
  const chartDataJson = buildChartDataJson(input);
  const context = buildTemplateContext(input, renderedTabs, chartDataJson);
  try {
    return compiled(context);
  } catch (e) {
    throw new Error(`[report] Erreur de rendu du template Handlebars : ${(e as Error).message}`);
  }
}

export function exportDefaultTemplate(dir: string): void {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  const target = path.join(dir, "report.hbs");
  if (fs.existsSync(target)) {
    throw new Error(`[export-template] ${target} existe déjà. Supprimer manuellement avant d'exporter.`);
  }
  const templateSrc = path.join(__dirname, "templates", "report.hbs");
  fs.copyFileSync(templateSrc, target);
  const schemaSrc = path.join(__dirname, "templates", "context.schema.json");
  fs.copyFileSync(schemaSrc, path.join(dir, "context.schema.json"));
  console.log(`Template exporté dans ${dir}/`);
  console.log(`  report.hbs          ← template principal (Handlebars)`);
  console.log(`  context.schema.json ← documentation des variables disponibles`);
}

// ─── Dupliqué depuis le bloc <script> embarqué ────────────────────────────────
// Dupliqué depuis le bloc <script> embarqué : les fonctions JS du template ne peuvent pas être importées
// directement par Vitest — cette version TypeScript est la seule surface testable unitairement.
export function computeMovingAvg(values: number[], windowSize = 4): (number | null)[] {
  return values.map((_, i) => {
    if (i < windowSize - 1) {return null;}
    const slice = values.slice(i - windowSize + 1, i + 1);
    return Math.round((slice.reduce((a, b) => a + b, 0) / windowSize) * 100) / 100;
  });
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

// exporté pour tests unitaires — évite de parser le HTML complet dans les tests
export function syncMetaLabel(lastSyncAt: string | null): string {
  if (!lastSyncAt) {return t("report.syncMeta.neverSynced");}
  return t("report.syncMeta.lastSync", { datetime: lastSyncAt.slice(0, 16).replace("T", " ") });
}

// exporté pour tests unitaires — évite de parser le HTML complet dans les tests
export function staleBannerHtml(isSyncStale: boolean, lastSyncAt: string | null): string {
  if (!isSyncStale) {return "";}
  const syncRef = lastSyncAt
    ? t("report.stale.syncRef", { date: lastSyncAt.slice(0, 10) })
    : t("report.stale.neverDone");
  return `<div class="stale-warning">${escapeHtml(t("report.stale.warning", { syncRef }))}</div>`;
}

// exporté pour test unitaire (cas trim slash + échappement HTML).
export function issueLink(key: string, jiraBaseUrl: string): string {
  if (!key) {return "";}
  const base = jiraBaseUrl.replace(/\/$/, "");
  return `<a href="${escapeHtml(base)}/browse/${escapeHtml(key)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>`;
}

const RISK_CLASS: Record<AgingRisk, string> = {
  ok: "risk-ok",
  watch: "risk-watch",
  "at-risk": "risk-at-risk",
  critical: "risk-critical",
};

// exporté pour test unitaire (vérifier la cellule Issue rend un <a> cliquable).
export function agingRowsHtml(data: AgingWipSummary, jiraBaseUrl: string): string {
  if (data.issues.length === 0) {
    return `<tr><td colspan="4">${escapeHtml(t("report.aging.noItems"))}</td></tr>`;
  }
  return data.issues
    .slice(0, 15)
    .map(
      (i) =>
        `<tr><td>${issueLink(i.issueKey, jiraBaseUrl)}</td><td>${escapeHtml(i.status)}</td><td>${i.ageDays.toFixed(1)}j</td><td class="${RISK_CLASS[i.riskLevel]}">${escapeHtml(i.riskLevel)}</td></tr>`,
    )
    .join("");
}

export type KpiDirection = "lower" | "higher";

export interface KpiCell {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  signal: HealthSignal;
  spark: number[];
  delta4w: number | null;
  direction: KpiDirection;
  helpKey?: string;
}

export interface KpiSignals {
  leadTime: HealthSignal;
  cycleTime: HealthSignal;
  throughput: HealthSignal;
  wip: HealthSignal;
  bugCycle: HealthSignal;
  bugRatio: HealthSignal;
}

const SPARK_WINDOW = 12;
const DELTA_WINDOW = 4;
const FLAT_DELTA_THRESHOLD_PCT = 1;
const VERDICT_PHRASE_LIMIT = 3;
const TOP3_LIMIT = 3;

function verdictLabels(): Record<VerdictStatus, string> {
  return {
    alert: t("report.verdict.alert"),
    watch: t("report.verdict.watch"),
    ok:    t("report.verdict.ok"),
  };
}

const SIGNAL_CLS: Record<HealthSignal, string> = {
  red: "red",
  orange: "amber",
  green: "green",
  none: "",
};

const SIGNAL_COLOR: Record<HealthSignal, string> = {
  red: "#ff4d6a",
  orange: "#ffc24a",
  green: "#4dd697",
  none: "#7a8194",
};

function formatKpiNumber(value: number | null): string {
  if (value === null) {return "—";}
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function fmtDelta(c: KpiCell): string {
  if (c.delta4w === null) {return `<span class="kpi-delta flat">— 4w</span>`;}
  const abs = Math.abs(c.delta4w);
  const flat = abs < FLAT_DELTA_THRESHOLD_PCT;
  const up = c.delta4w > 0;
  const polarity = up === (c.direction === "higher") ? "good" : "bad";
  const cls = flat ? "flat" : `${up ? "up" : "down"} ${polarity}`;
  const sign = flat ? "■" : up ? "▲" : "▼";
  return `<span class="kpi-delta ${cls}">${sign} ${abs.toFixed(0)}% 4w</span>`;
}

function lastValue(values: number[]): number | null {
  return values.length === 0 ? null : values[values.length - 1];
}

function delta4w(values: number[]): number | null {
  if (values.length < DELTA_WINDOW + 1) {return null;}
  const curr = values[values.length - 1];
  const refSlice = values.slice(-DELTA_WINDOW - 1, -1);
  const ref = refSlice.reduce((a, b) => a + b, 0) / refSlice.length;
  if (ref === 0) {return null;}
  return ((curr - ref) / ref) * 100;
}

function sparkOf(values: number[]): number[] {
  return values.slice(-SPARK_WINDOW);
}

export function buildKpiCells(
  charts: Partial<Record<string, ChartSeries>>,
  agingWip: AgingWipSummary,
  signals: KpiSignals,
): KpiCell[] {
  const lead = charts.leadTime?.series.median ?? [];
  const cycle = charts.cycleTime?.series.median ?? [];
  const thr = charts.throughput?.series.count ?? [];
  const wip = charts.wip?.series.count ?? [];
  const bugCycle = charts.bugCycleTime?.series.median ?? [];
  const bugRatioRaw = charts.devTimeAllocation?.series.bugRatio ?? [];
  const bugRatioPct = bugRatioRaw.map((v) => v * 100);
  const ftrDevRaw = charts.ftrByRole?.series.dev ?? [];
  const ftrDevPct = ftrDevRaw.map((v) => v * 100);
  const criticalCount = agingWip.issues.filter((i) => i.riskLevel === "critical").length;
  const criticalHistory = charts.agingWipRisk?.series.critical ?? [];

  return [
    { key: "lead",      label: "Lead median",     value: lastValue(lead),       unit: "j",   signal: signals.leadTime,   spark: sparkOf(lead),       delta4w: delta4w(lead),       direction: "lower",  helpKey: "leadTime" },
    { key: "cycle",     label: "Cycle median",    value: lastValue(cycle),      unit: "j",   signal: signals.cycleTime,  spark: sparkOf(cycle),      delta4w: delta4w(cycle),      direction: "lower",  helpKey: "cycleTime" },
    { key: "throughput", label: "Throughput / 7j", value: lastValue(thr),       unit: "iss", signal: signals.throughput, spark: sparkOf(thr),        delta4w: delta4w(thr),        direction: "higher", helpKey: "throughput" },
    { key: "wip",       label: "WIP",             value: lastValue(wip),        unit: "",    signal: signals.wip,        spark: sparkOf(wip),        delta4w: delta4w(wip),        direction: "lower",  helpKey: "wip" },
    { key: "bugRatio",  label: "Bug ratio",       value: lastValue(bugRatioPct), unit: "%",  signal: signals.bugRatio,   spark: sparkOf(bugRatioPct), delta4w: delta4w(bugRatioPct), direction: "lower",  helpKey: "devTimeAllocation" },
    { key: "bugCycle",  label: "Bug cycle",       value: lastValue(bugCycle),   unit: "j",   signal: signals.bugCycle,   spark: sparkOf(bugCycle),   delta4w: delta4w(bugCycle),   direction: "lower",  helpKey: "bugCycleTime" },
    { key: "ftrDev",    label: "FTR dev",         value: lastValue(ftrDevPct),  unit: "%",   signal: "none",             spark: sparkOf(ftrDevPct),  delta4w: delta4w(ftrDevPct),  direction: "higher", helpKey: "firstTimeRight" },
    // pourquoi: criticalAging dérive son signal directement du compteur (pas de healthThresholds dédié) — toute issue critical est par définition au-delà du P95 historique.
    { key: "criticalAging", label: "Critical aging", value: criticalCount,      unit: "",    signal: criticalCount > 0 ? "red" : "green", spark: sparkOf(criticalHistory), delta4w: null, direction: "lower",  helpKey: "agingWip" },
  ];
}

export type VerdictStatus = "alert" | "watch" | "ok";

export interface Verdict {
  status: VerdictStatus;
  phrase: string;
}

function fmtCellValueWithUnit(c: KpiCell): string {
  const v = formatKpiNumber(c.value);
  return c.unit && c.value !== null ? `${v}${c.unit}` : v;
}

export function computeVerdict(cells: KpiCell[]): Verdict {
  const reds = cells.filter((c) => c.signal === "red");
  const oranges = cells.filter((c) => c.signal === "orange");
  if (reds.length === 0 && oranges.length === 0) {
    return { status: "ok", phrase: t("report.verdict.allGreen") };
  }
  const dominants = (reds.length > 0 ? reds : oranges).slice(0, VERDICT_PHRASE_LIMIT);
  const parts = dominants.map(
    (c) => `${escapeHtml(c.label)} <strong>${escapeHtml(fmtCellValueWithUnit(c))}</strong>`,
  );
  const verbe = reds.length > 0 ? t("report.verdict.aboveCritical") : t("report.verdict.inWatch");
  return {
    status: reds.length > 0 ? "alert" : "watch",
    phrase: `${parts.join(" · ")} ${verbe}.`,
  };
}

export function buildTop3Actions(agingWip: AgingWipSummary, jiraBaseUrl: string): string {
  const byAgeDesc = (a: AgingWipIssue, b: AgingWipIssue): number => b.ageDays - a.ageDays;
  const critical = agingWip.issues.filter((i) => i.riskLevel === "critical").sort(byAgeDesc);
  const atRisk = agingWip.issues.filter((i) => i.riskLevel === "at-risk").sort(byAgeDesc);
  const top = [...critical, ...atRisk].slice(0, TOP3_LIMIT);
  if (top.length === 0) {
    return `<div class="action ok"><div class="action-num">// 01</div><div class="action-title">${escapeHtml(t("report.actions.noIssues"))}</div><div class="action-detail">${escapeHtml(t("report.actions.noBelowP85"))}</div></div>`;
  }
  return top
    .map((iss, idx) => {
      const cls = iss.riskLevel === "critical" ? "crit" : "warn";
      const num = String(idx + 1).padStart(2, "0");
      const seuil = iss.riskLevel === "critical"
        ? `&gt; P95 (${agingWip.percentiles.p95.toFixed(1)}j)`
        : `&gt; P85 (${agingWip.percentiles.p85.toFixed(1)}j)`;
      return `<div class="action ${cls}"><div class="action-num">// ${num}</div><div class="action-title">${escapeHtml(t("report.actions.unblock"))} ${issueLink(iss.issueKey, jiraBaseUrl)}</div><div class="action-detail">${escapeHtml(iss.status)} · ${escapeHtml(t("report.actions.age"))} <strong>${iss.ageDays.toFixed(1)}j</strong> ${seuil} · ${escapeHtml(iss.riskLevel)}</div></div>`;
    })
    .join("");
}

export function buildScopeAlertBanner(store: ReadStore, scopeData: ScopeChangeResult): string {
  if (scopeData.changedIssues === 0) {return "";}

  // pourquoi : ticket 050 — reproduit `WHERE state='active' ORDER BY start_date DESC LIMIT 1`
  // côté JS ; localeCompare décroissant simule le ORDER BY DESC.
  const activeSprints = store.sprints.all()
    .filter((s) => s.state === "active")
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  if (activeSprints.length === 0) {return "";}
  const activeSprint = activeSprints[0];

  const alertSprints = (scopeData.bySprint[activeSprint.name]?.changedIssues ?? 0) > 0
    ? [activeSprint.name]
    : [];

  if (alertSprints.length === 0) {return "";}

  const count = alertSprints.reduce((s, n) => s + (scopeData.bySprint[n]?.changedIssues ?? 0), 0);
  const sprintLabel = alertSprints.join(", ");
  const banner = t("report.scope.alertBanner", { count: String(count) });
  const sprintDetail = t("report.scope.alertSprint", { sprint: sprintLabel });
  return `<div class="alert-orange">${banner} <span class="alert-detail">${escapeHtml(sprintDetail)}</span></div>`;
}

export function buildScopeChangeChart(scopeData: ScopeChangeResult): string {
  const sprintNames = Object.keys(scopeData.bySprint).sort((a, b) => {
    const numA = parseInt((/\d+/.exec(a))?.[0] ?? "0", 10);
    const numB = parseInt((/\d+/.exec(b))?.[0] ?? "0", 10);
    return numA - numB;
  });

  const shortLabels = sprintNames.map((n) => {
    const idx = n.indexOf(" - ");
    return idx >= 0 ? n.slice(idx + 3) : n;
  });

  const extracted = sprintNames.map((n) => {
    const s = scopeData.bySprint[n];
    return {
      changed: s?.changedIssues ?? 0,
      unchanged: (s?.totalIssues ?? 0) - (s?.changedIssues ?? 0),
      ratio: Math.round((s?.changeRatio ?? 0) * 100),
    };
  });

  return JSON.stringify({
    type: "bar",
    data: {
      labels: shortLabels,
      datasets: [
        { label: t("report.js.label.scopeChanged"), data: extracted.map((e) => e.changed), backgroundColor: "rgba(224, 49, 49, 0.75)", stack: "scope" },
        {
          label: t("report.js.label.scopeDriftRate"), data: extracted.map((e) => e.ratio), type: "line", yAxisID: "y2",
          borderColor: "#0bc5ea", backgroundColor: "rgba(11, 197, 234, 0.08)",
          borderWidth: 2, borderDash: [5, 3], pointRadius: 5, pointBackgroundColor: "#0bc5ea",
          tension: 0.3, fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7 } },
      scales: {
        x: { ticks: { maxRotation: 0, minRotation: 0 } },
        y:  { stacked: true, min: 0, ticks: { stepSize: 1 }, title: { display: true, text: t("report.js.axis.nbIssues") } },
        y2: { position: "right", min: 0, suggestedMax: 110, title: { display: true, text: t("report.js.axis.driftRate") }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

export function buildScopeSection(scopeData: ScopeChangeResult, store: ReadStore, jiraBaseUrl: string): string {
  const chartCfg = buildScopeChangeChart(scopeData);

  let tableHtml = "";
  if (scopeData.changedIssueKeys.length > 0) {
    const keys = scopeData.changedIssueKeys;
    const summaries = store.issues.byKeys(keys);
    const summaryByKey = new Map(summaries.map((r) => [r.key, r.summary]));

    const sprintNames = Object.keys(scopeData.bySprint);
    // pourquoi : ticket 050 — Set pour O(1) lookup au lieu d'un IN(?...) SQL.
    const sprintNamesSet = new Set(sprintNames);
    const sprintStartRows = sprintNames.length > 0
      ? store.sprints.all()
          .filter((s) => sprintNamesSet.has(s.name))
          .map((s) => ({ name: s.name, start_date: s.startDate ?? "" }))
      : [];
    const sprintStartByName = new Map(sprintStartRows.map((r) => [r.name, r.start_date]));

    const sprintByKey = new Map<string, string>();
    for (const [sprintName, stats] of Object.entries(scopeData.bySprint)) {
      if (!stats) {continue;}
      for (const detail of stats.issueDetails) {
        sprintByKey.set(detail.key, sprintName);
      }
    }

    const sortedKeys = [...keys].sort((a, b) => {
      const sa = sprintByKey.get(a) ?? "";
      const sb = sprintByKey.get(b) ?? "";
      if (sa === sb) {return a.localeCompare(b);}
      if (!sa) {return 1;}
      if (!sb) {return -1;}
      const da = sprintStartByName.get(sa) ?? sa;
      const db2 = sprintStartByName.get(sb) ?? sb;
      return da < db2 ? 1 : da > db2 ? -1 : 0;
    });

    const rows = sortedKeys.map((key) => {
      const sprint = sprintByKey.get(key) ?? "—";
      const sprintStart = sprintStartByName.get(sprint) ?? sprint;
      const summary = summaryByKey.get(key) ?? "";
      return `<tr data-sprint-start="${escapeHtml(sprintStart)}"><td>${issueLink(key, jiraBaseUrl)}</td><td>${escapeHtml(sprint)}</td><td>${escapeHtml(summary)}</td></tr>`;
    }).join("");

    tableHtml = `<table class="scope-issues-table" id="scopeIssuesTable">
      <thead><tr><th data-col="0">${escapeHtml(t("report.scope.tableKey"))}</th><th data-col="1" class="sort-desc">${escapeHtml(t("report.scope.tableSprint"))}</th><th data-col="2">${escapeHtml(t("report.scope.tableSummary"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const hasData = Object.keys(scopeData.bySprint).length > 0;

  return `<section class="scope-section">
  <div class="actions-head"><h2>${escapeHtml(t("report.scope.title"))}</h2><div class="sep"></div></div>
  <p class="scope-help">${escapeHtml(t("report.scope.help"))}</p>
  ${hasData ? "" : `<p class="text-dim">${escapeHtml(t("report.scope.noDrift"))}</p>`}
  ${hasData ? `<div class="chart-card wide"><div class="chart-wrap"><canvas id="scopeChangeChart"></canvas></div></div>` : ""}
  ${tableHtml}
  <script>
  (function(){
    var ctx = document.getElementById('scopeChangeChart');
    if (ctx) { new Chart(ctx, ${chartCfg}); }
  })();
  (function(){
    var table = document.getElementById('scopeIssuesTable');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    var ths = table.querySelectorAll('th[data-col]');
    var sortCol = 1, sortAsc = false;
    function cellValue(row, col) {
      if (col === 1) return row.dataset.sprintStart || '';
      return row.cells[col].textContent || '';
    }
    function sort() {
      var rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var av = cellValue(a, sortCol), bv = cellValue(b, sortCol);
        var cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return sortAsc ? cmp : -cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      ths.forEach(function(th) {
        th.classList.remove('sort-asc', 'sort-desc');
        if (Number(th.dataset.col) === sortCol) th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
      });
    }
    ths.forEach(function(th) {
      th.addEventListener('click', function() {
        var col = Number(th.dataset.col);
        if (col === sortCol) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
        sort();
      });
    });
  })();
  </script>
</section>`;
}

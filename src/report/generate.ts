import fs from "fs";
import path from "path";
import { BUCKET_ORDER, buildHistogramBins } from "../metrics/utils";
import { type MetricConfig } from "../metrics/types";
import { agingWipMetric } from "../metrics/agingWip";
import { forecastMetric } from "../metrics/forecast";
import { cycleTimeMetric } from "../metrics/cycleTime";
import { scopeChangeMetric } from "../metrics/scopeChange";
import { bottleneckAnalysisMetric } from "../metrics/bottleneckAnalysis";
import { durationDistributionMetric } from "../metrics/durationDistribution";
import { now } from "../clock";
import { type LocaleShape, type LocaleCode } from "../i18n/index";
import { CHART_DEFS } from "./chartDefs";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import type { ReadStore, SprintRecord } from "../store/types";
import { buildMetricsContext } from "../metrics/context";
import {
  type SnapshotRow,
  type ChartSeries,
  buildBucketSeries,
  buildAllChartData,
  pickValue,
  latestBySize,
} from "./snapshotSeries";
import { resolveThresholds, type HealthThresholds } from "./healthThresholds";
import { resolvePersonalization, type ReportPersonalization } from "./personalization";
import { buildSprintSeries, buildRolesSprintSeries, type SprintRow } from "./sprintSeries";
import { buildScopeAlertBanner, buildScopeSection } from "./scopeReport";
import { renderWithHandlebars } from "./templateContext";
import type { RenderInput } from "./types";

// pourquoi : re-exports — surface API publique attendue par tests/report/**.
// Les modules réels résident dans les fichiers cités, generate.ts reste
// l'orchestrateur historique.
export { issueLink, agingRowsHtml, syncMetaLabel, staleBannerHtml } from "./htmlHelpers";
export { buildAllChartData, buildBucketSeries, buildRoleSeries } from "./snapshotSeries";
export { computeMovingAvg } from "./movingAvg";
export { buildScopeAlertBanner, buildScopeChangeChart, buildScopeSection } from "./scopeReport";
export { estimationFlags, type EstimationFlags } from "./estimation";
export { buildSprintSeries, buildRolesSprintSeries, type SprintChartSeries } from "./sprintSeries";
export { buildKpiCells, computeVerdict, buildTop3Actions, type KpiCell, type KpiSignals, type KpiDirection, type Verdict, type VerdictStatus } from "./kpi";
export {
  buildTemplateContext,
  renderWithHandlebars,
  exportDefaultTemplate,
  buildChartDataJson,
  type TemplateContext,
} from "./templateContext";
export {
  resolvePersonalization,
  type ReportPersonalization,
  type ResolvedPersonalization,
} from "./personalization";
export {
  evalLowerBetter,
  evalHigherBetter,
  computeDynamicThresholds,
  resolveThresholds,
  type HealthThresholds,
  type ThresholdPair,
  type HealthSignal,
} from "./healthThresholds";

export function buildReportLabels(lang: LocaleCode): LocaleShape {
  return lang === "fr" ? fr : en;
}

const STALE_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 86_400_000;

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
  const distribution = durationDistributionMetric.compute(liveCtx);
  const cycleTime = cycleTimeMetric.compute(liveCtx);
  const cycleValues = cycleTime.issues.map((i) => i.cycleTimeDays);
  const histogram = buildHistogramBins(cycleValues, cycleValues.length > 0 ? Math.max(...cycleValues) : 0);

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
    distribution,
    sprintCharts,
    rolesSprintCharts,
  };

  const resolvedTemplatePath = personalization?.templatePath
    ? path.resolve(boardDir ?? process.cwd(), personalization.templatePath)
    : path.join(__dirname, "templates", "report.hbs");

  const html = renderWithHandlebars(renderInput, resolvedTemplatePath);

  fs.writeFileSync(outputPath, html);
}

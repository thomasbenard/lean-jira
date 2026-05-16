import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import { escapeHtml, syncMetaLabel, staleBannerHtml } from "./htmlHelpers";
import { estimationFlags } from "./estimation";
import { CHART_DEFS, serializeChartDefs } from "./chartDefs";
import { t, getCurrentLocale, type LocaleShape } from "../i18n/index";
import type { AgingWipSummary } from "../metrics/agingWip";
import type { ForecastSummary } from "../metrics/forecast";
import type { RenderInput } from "./types";
import { buildRenderedTabs, buildVerdictHtml, buildKpiGridHtml } from "./tabsHtml";
import { buildTop3Actions } from "./kpi";

export function buildChartDataJson(input: RenderInput): string {
  return JSON.stringify({
    charts: input.charts,
    histogram: input.histogram,
    cycleStats: input.cycleStats,
    aging: { issues: input.agingWip.issues, percentiles: input.agingWip.percentiles },
    leadBySize: input.leadTimeBySizeCharts,
    cycleBySize: input.cycleTimeBySizeCharts,
    distribution: input.distribution,
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
  const filteredTabs = renderedTabs.filter((tab) => !excludedTabs.has(tab.id));
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
    tabs: filteredTabs.map((tab) => ({ ...tab, active: tab.id === firstId })),
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

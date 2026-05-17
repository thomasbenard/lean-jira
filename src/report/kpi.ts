import { t } from "../i18n/index";
import { escapeHtml, issueLink } from "./htmlHelpers";
import type { ChartSeries } from "./snapshotSeries";
import type { AgingWipSummary, AgingWipIssue } from "../metrics/agingWip";
import type { HealthSignal } from "./healthThresholds";

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

export type VerdictStatus = "alert" | "watch" | "ok";

export interface Verdict {
  status: VerdictStatus;
  phrase: string;
}

const SPARK_WINDOW = 12;
const DELTA_WINDOW = 4;
const FLAT_DELTA_THRESHOLD_PCT = 1;
const VERDICT_PHRASE_LIMIT = 3;
const TOP3_LIMIT = 3;

export function verdictLabels(): Record<VerdictStatus, string> {
  return {
    alert: t("report.verdict.alert"),
    watch: t("report.verdict.watch"),
    ok:    t("report.verdict.ok"),
  };
}

export const SIGNAL_CLS: Record<HealthSignal, string> = {
  red: "red",
  orange: "amber",
  green: "green",
  none: "",
};

export const SIGNAL_COLOR: Record<HealthSignal, string> = {
  red: "#ff4d6a",
  orange: "#ffc24a",
  green: "#4dd697",
  none: "#7a8194",
};

export function formatKpiNumber(value: number | null): string {
  if (value === null) {return "—";}
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

export function fmtDelta(c: KpiCell): string {
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

const DAILY_CADENCE_MAX_STEP_DAYS = 2;
const DELTA_OFFSET_DAYS = 28;

function dateDiffDays(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00Z").getTime();
  const b = new Date(bISO + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

function delta4w(values: number[], dates: string[] = []): number | null {
  if (values.length === 0) {return null;}
  const curr = values[values.length - 1];
  // pourquoi : cadence quotidienne (WIP) vs hebdo (lead/cycle/throughput) : sur
  // daily, moyenner les 4 dernières valeurs = 4 jours = bruit. On compare donc
  // à la valeur à ~J-28 par date. Sur weekly, on garde la moyenne des 4 slots
  // précédents (semantique historique).
  if (dates.length === values.length && values.length >= 2) {
    const stepDays = dateDiffDays(dates[dates.length - 1], dates[dates.length - 2]);
    if (stepDays > 0 && stepDays <= DAILY_CADENCE_MAX_STEP_DAYS) {
      const lastISO = dates[dates.length - 1];
      const target = new Date(lastISO + "T00:00:00Z");
      target.setUTCDate(target.getUTCDate() - DELTA_OFFSET_DAYS);
      const targetISO = target.toISOString().slice(0, 10);
      let refIdx = -1;
      for (let i = 0; i < dates.length; i++) {
        if (dates[i] <= targetISO) {refIdx = i;}
        else {break;}
      }
      if (refIdx < 0) {return null;}
      const ref = values[refIdx];
      if (ref === 0) {return null;}
      return ((curr - ref) / ref) * 100;
    }
  }
  if (values.length < DELTA_WINDOW + 1) {return null;}
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
  const leadDates = charts.leadTime?.dates ?? [];
  const cycle = charts.cycleTime?.series.median ?? [];
  const cycleDates = charts.cycleTime?.dates ?? [];
  const thr = charts.throughput?.series.count ?? [];
  const thrDates = charts.throughput?.dates ?? [];
  const wip = charts.wip?.series.count ?? [];
  const wipDates = charts.wip?.dates ?? [];
  const bugCycle = charts.bugCycleTime?.series.median ?? [];
  const bugCycleDates = charts.bugCycleTime?.dates ?? [];
  const bugRatioRaw = charts.devTimeAllocation?.series.bugRatio ?? [];
  const bugRatioPct = bugRatioRaw.map((v) => v * 100);
  const bugRatioDates = charts.devTimeAllocation?.dates ?? [];
  const ftrDevRaw = charts.ftrByRole?.series.dev ?? [];
  const ftrDevPct = ftrDevRaw.map((v) => v * 100);
  const ftrDevDates = charts.ftrByRole?.dates ?? [];
  const criticalCount = agingWip.issues.filter((i) => i.riskLevel === "critical").length;
  const criticalHistory = charts.agingWipRisk?.series.critical ?? [];

  return [
    { key: "lead",      label: "Lead median",     value: lastValue(lead),       unit: "j",   signal: signals.leadTime,   spark: sparkOf(lead),       delta4w: delta4w(lead, leadDates),       direction: "lower",  helpKey: "leadTime" },
    { key: "cycle",     label: "Cycle median",    value: lastValue(cycle),      unit: "j",   signal: signals.cycleTime,  spark: sparkOf(cycle),      delta4w: delta4w(cycle, cycleDates),      direction: "lower",  helpKey: "cycleTime" },
    { key: "throughput", label: "Throughput / 7j", value: lastValue(thr),       unit: "iss", signal: signals.throughput, spark: sparkOf(thr),        delta4w: delta4w(thr, thrDates),        direction: "higher", helpKey: "throughput" },
    { key: "wip",       label: "WIP",             value: lastValue(wip),        unit: "",    signal: signals.wip,        spark: sparkOf(wip),        delta4w: delta4w(wip, wipDates),        direction: "lower",  helpKey: "wip" },
    { key: "bugRatio",  label: "Bug ratio",       value: lastValue(bugRatioPct), unit: "%",  signal: signals.bugRatio,   spark: sparkOf(bugRatioPct), delta4w: delta4w(bugRatioPct, bugRatioDates), direction: "lower",  helpKey: "devTimeAllocation" },
    { key: "bugCycle",  label: "Bug cycle",       value: lastValue(bugCycle),   unit: "j",   signal: signals.bugCycle,   spark: sparkOf(bugCycle),   delta4w: delta4w(bugCycle, bugCycleDates),   direction: "lower",  helpKey: "bugCycleTime" },
    { key: "ftrDev",    label: "FTR dev",         value: lastValue(ftrDevPct),  unit: "%",   signal: "none",             spark: sparkOf(ftrDevPct),  delta4w: delta4w(ftrDevPct, ftrDevDates),  direction: "higher", helpKey: "firstTimeRight" },
    // pourquoi: criticalAging dérive son signal directement du compteur (pas de healthThresholds dédié) — toute issue critical est par définition au-delà du P95 historique.
    { key: "criticalAging", label: "Critical aging", value: criticalCount,      unit: "",    signal: criticalCount > 0 ? "red" : "green", spark: sparkOf(criticalHistory), delta4w: null, direction: "lower",  helpKey: "agingWip" },
  ];
}

export function fmtCellValueWithUnit(c: KpiCell): string {
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

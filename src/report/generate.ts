import Database from "better-sqlite3";
import fs from "fs";
import { BUCKET_LABELS, BUCKET_ORDER, SizeBucket } from "../metrics/utils";
import { MetricConfig } from "../metrics/types";
import { agingWipMetric, AgingWipSummary } from "../metrics/agingWip";
import { forecastMetric, ForecastSummary } from "../metrics/forecast";
import { cycleTimeMetric } from "../metrics/cycleTime";

interface SnapshotRow {
  snapshot_date: string;
  metric_name: string;
  bucket: string;
  stat: string;
  value: number;
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

const HELP_TEXTS: Record<string, { title: string; body: string }> = {
  leadTime: {
    title: "Lead time",
    body:
      "Délai total entre l'entrée du ticket en colonne TODO du board (engagement de l'équipe) et sa résolution. Inclut l'attente backlog, le design et le dev. Indicateur de prévisibilité côté demandeur. Outliers extrêmes retirés (Tukey upper fence).",
  },
  cycleTime: {
    title: "Cycle time",
    body:
      "Durée du dev actif: première transition vers une colonne 'Développement en cours' jusqu'à la livraison. Exclut l'attente backlog et le design. Mesure l'efficacité de l'équipe en boucle dev pure.",
  },
  throughput: {
    title: "Throughput",
    body:
      "Nombre brut d'issues livrées par fenêtre de 7 jours. Mesure la capacité de débit sans pondération de taille. À combiner avec le throughput pondéré pour distinguer 'beaucoup de petits tickets' vs 'gros chantiers'.",
  },
  throughputWeighted: {
    title: "Throughput pondéré",
    body:
      "Somme des jours-personnes estimés des issues livrées dans la fenêtre. Bugs exclus (non estimés par nature). Compense le biais 'beaucoup de petits tickets gonflent le throughput brut'.",
  },
  wip: {
    title: "WIP (Work In Progress)",
    body:
      "Nombre d'issues simultanément en cours à la fin de chaque semaine. Loi de Little: cycle_time = WIP / throughput. Limiter le WIP réduit le cycle time. Reconstitué historiquement à partir des transitions, sans scoping sprint.",
  },
  bugThroughput: {
    title: "Bug throughput",
    body:
      "Bugs livrés par fenêtre de 7j. Indicateur de charge incidents, à comparer avec le throughput de features. Une hausse signale soit une dette qualité qui remonte, soit une équipe en mode pompier.",
  },
  bugCycleTime: {
    title: "Bug cycle time",
    body:
      "Cycle time des issues type Bug uniquement (non estimés par nature). Mesure la réactivité aux incidents (vs cycle time global qui mélange features + bugs).",
  },
  leadTimeNormalized: {
    title: "Lead time normalisé",
    body:
      "Lead time réel divisé par l'estimation originale. 1 = on time, 2 = 2× plus long que prévu. Indicateur de dérive d'estimation côté demandeur. Bugs exclus (pas d'estimation).",
  },
  cycleTimeNormalized: {
    title: "Cycle time normalisé",
    body:
      "Cycle time réel divisé par l'estimation originale. Idem normalized lead, mais sur la phase dev seule. Si médiane > 1 = équipe sous-estime systématiquement.",
  },
  leadTimeBySize: {
    title: "Lead time par taille",
    body:
      "Lead time agrégé par bucket de taille (estimation originale): XS <0.5j, S 0.5-1j, M 1-3j, L 3-5j, XL ≥5j. BUG = bugs (non estimés). UNESTIMATED = vrais oublis d'estimation.",
  },
  cycleTimeBySize: {
    title: "Cycle time par taille",
    body:
      "Idem lead-time-by-size mais sur la phase dev. Sert à valider la cohérence: un L doit avoir un cycle médian > qu'un M. Une inversion révèle un problème (sous-estimation, refactoring caché).",
  },
  flowEfficiency: {
    title: "Flow efficiency",
    body:
      "Ratio temps actif / (actif + queue) sur la phase cycle-time. 'Actif' = Dev/Design/QA in progress. 'Queue' = review, validation, ready-for-X. Typique 5-15% : la majorité du temps est de l'attente, pas du travail. Si la médiane chute, le workflow a un goulot (handoffs, WIP non limité).",
  },
  agingWip: {
    title: "Aging WIP",
    body:
      "Pour chaque ticket en cours : âge (jours ouvrés depuis le 1er passage en dev) comparé aux percentiles cycle-time historiques. Risque OK ≤ P50, watch ≤ P85, at-risk ≤ P95, critical > P95. Métrique actionnable : un ticket 'critical' va presque sûrement rater son SLE — agir maintenant.",
  },
  cycleHistogram: {
    title: "Distribution cycle time",
    body:
      "Histogramme des cycle times des issues résolues (depuis cutoff). La moyenne ment quand la distribution est asymétrique (queue droite typique). Lire la médiane (P50), P85 (engagement raisonnable) et la longueur de la queue.",
  },
  forecast: {
    title: "Forecast Monte Carlo",
    body:
      "Simule 10 000 scénarios de livraison à partir des throughput hebdo des 12 dernières semaines. P15 = engagement à 85% de confiance (« on livrera au moins X »). P50 = livraison médiane attendue. P85/P95 = optimiste. Résultat varie d'un run à l'autre (aléa contrôlé).",
  },
};

export function generateReport(
  db: Database.Database,
  projectKey: string,
  outputPath: string,
  config: MetricConfig,
): void {
  const snapshots = db.prepare(
    "SELECT snapshot_date, metric_name, bucket, stat, value FROM metric_snapshots ORDER BY snapshot_date ASC"
  ).all() as SnapshotRow[];

  if (snapshots.length === 0) {
    throw new Error("Aucun snapshot. Lancer `npm run snapshots` d'abord.");
  }

  // Pré-grouper par metric_name pour un parcours O(N) au lieu de O(N×M).
  const byMetric = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const arr = byMetric.get(s.metric_name);
    if (arr) arr.push(s);
    else byMetric.set(s.metric_name, [s]);
  }
  const metricRows = (name: string) => byMetric.get(name) ?? [];

  const charts = {
    leadTime: buildSeries(metricRows("lead-time"), "", ["median", "p85"]),
    cycleTime: buildSeries(metricRows("cycle-time"), "", ["median", "p85"]),
    throughput: buildSeries(metricRows("throughput"), "", ["count"]),
    throughputWeighted: buildSeries(metricRows("throughput-weighted"), "", ["count", "estimatedDays"]),
    wip: buildSeries(metricRows("wip"), "", ["count"]),
    bugThroughput: buildSeries(metricRows("bug-throughput"), "", ["count"]),
    bugCycleTime: buildSeries(metricRows("bug-cycle-time"), "", ["median", "p85"]),
    leadTimeNormalized: buildSeries(metricRows("lead-time-normalized"), "", ["median", "p85"]),
    cycleTimeNormalized: buildSeries(metricRows("cycle-time-normalized"), "", ["median", "p85"]),
    flowEfficiency: buildSeries(metricRows("flow-efficiency"), "", ["aggregate", "median"]),
    agingWipRisk: buildSeries(metricRows("aging-wip"), "", ["ok", "watch", "atRisk", "critical"]),
  };

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
  };

  const leadBySize = latestBySize(latestRows.filter((r) => r.metric_name === "lead-time-by-size"));
  const cycleBySize = latestBySize(latestRows.filter((r) => r.metric_name === "cycle-time-by-size"));
  const agingWip = agingWipMetric.compute(db, config);
  const forecast = forecastMetric.compute(db, config);
  const cycleTime = cycleTimeMetric.compute(db, config);
  const histogram = buildHistogram(cycleTime.issues.map((i) => i.cycleTimeDays));

  const html = renderHtml({
    projectKey,
    generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    lastSnapshotDate: lastDate,
    kpis,
    charts,
    leadBySize,
    cycleBySize,
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
  });

  fs.writeFileSync(outputPath, html);
}

function buildSeries(snapshots: SnapshotRow[], bucket: string, stats: string[]): ChartSeries {
  const dateSet = new Set<string>();
  const byKey = new Map<string, Map<string, number>>();
  for (const stat of stats) byKey.set(stat, new Map());

  for (const s of snapshots) {
    if (s.bucket !== bucket) continue;
    if (!stats.includes(s.stat)) continue;
    dateSet.add(s.snapshot_date);
    byKey.get(s.stat)!.set(s.snapshot_date, s.value);
  }

  const dates = [...dateSet].sort();
  const series: Record<string, number[]> = {};
  for (const stat of stats) {
    const m = byKey.get(stat)!;
    series[stat] = dates.map((d) => m.get(d) ?? 0);
  }
  return { dates, series };
}

function pickValue(rows: SnapshotRow[], metric: string, bucket: string, stat: string): number | null {
  const r = rows.find((x) => x.metric_name === metric && x.bucket === bucket && x.stat === stat);
  return r ? r.value : null;
}

function latestBySize(rows: SnapshotRow[]): Record<string, BucketStats> {
  const out: Record<string, BucketStats> = {};
  for (const r of rows) {
    if (!out[r.bucket]) out[r.bucket] = { count: 0, median: 0, p85: 0 };
    if (r.stat === "count") out[r.bucket].count = r.value;
    else if (r.stat === "median") out[r.bucket].median = r.value;
    else if (r.stat === "p85") out[r.bucket].p85 = r.value;
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
  generatedAt: string;
  lastSnapshotDate: string;
  kpis: Record<string, number | null>;
  charts: Record<string, ChartSeries>;
  leadBySize: Record<string, BucketStats>;
  cycleBySize: Record<string, BucketStats>;
  agingWip: AgingWipSummary;
  forecast: ForecastSummary;
  histogram: HistogramBin[];
  cycleStats: { median: number; p85: number; p95: number; avg: number; count: number };
}

function buildHistogram(values: number[]): HistogramBin[] {
  if (values.length === 0) return [];
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

function renderHtml(input: RenderInput): string {
  const fmt = (v: number | null, unit = "j") =>
    v === null ? "—" : `${v.toFixed(1)}<span class="unit">${unit}</span>`;
  const fmtInt = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
  const fmtPct = (v: number | null) =>
    v === null ? "—" : `${(v * 100).toFixed(1)}<span class="unit">%</span>`;

  const bySizeRows = (data: Record<string, BucketStats>) =>
    BUCKET_ORDER.map((b) => {
      const s = data[b];
      if (!s || s.count === 0) return "";
      return `<tr><td>${escapeHtml(BUCKET_LABELS[b as SizeBucket])}</td><td>${s.count}</td><td>${s.median.toFixed(1)}j</td><td>${s.p85.toFixed(1)}j</td></tr>`;
    }).join("");

  const agingTableRows = (data: AgingWipSummary) => {
    if (data.issues.length === 0) {
      return `<tr><td colspan="4">Aucun item en cours.</td></tr>`;
    }
    const riskClass: Record<string, string> = {
      ok: "risk-ok",
      watch: "risk-watch",
      "at-risk": "risk-at-risk",
      critical: "risk-critical",
    };
    return data.issues
      .slice(0, 15)
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.issueKey)}</td><td>${escapeHtml(i.status)}</td><td>${i.ageDays.toFixed(1)}j</td><td class="${riskClass[i.riskLevel]}">${escapeHtml(i.riskLevel)}</td></tr>`,
      )
      .join("");
  };

  const forecastTableRows = (data: ForecastSummary) => {
    if (data.byHorizon.length === 0) {
      return `<tr><td colspan="5">Pas de throughput récent.</td></tr>`;
    }
    return data.byHorizon
      .map(
        (h) =>
          `<tr><td>${h.weeks} sem.</td><td><strong>${h.p15.toFixed(0)}</strong></td><td>${h.p50.toFixed(0)}</td><td>${h.p85.toFixed(0)}</td><td>${h.p95.toFixed(0)}</td></tr>`,
      )
      .join("");
  };

  const helpBtn = (key: string) => {
    const h = HELP_TEXTS[key];
    if (!h) return "";
    return `<span class="help-wrap"><button class="help-btn" aria-label="Aide">?</button><span class="help-popover" role="tooltip"><strong>${escapeHtml(h.title)}</strong>${escapeHtml(h.body)}</span></span>`;
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport Lean — ${escapeHtml(input.projectKey)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; color: #1a1a1a; background: #fafafa; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  h2 { border-bottom: 2px solid #ddd; padding-bottom: 0.4rem; margin-top: 2.5rem; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
  .kpi { background: white; border: 1px solid #e3e3e3; border-radius: 6px; padding: 1rem; }
  .kpi .label { display: block; font-size: 0.8rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi .value { display: block; font-size: 1.8rem; font-weight: 600; margin-top: 0.4rem; }
  .kpi .unit { font-size: 0.9rem; color: #888; margin-left: 0.15rem; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .chart-card { background: white; border: 1px solid #e3e3e3; border-radius: 6px; padding: 1rem; }
  .chart-card h3 { margin: 0 0 0.5rem 0; font-size: 1rem; }
  canvas { max-height: 280px; }
  table { width: 100%; border-collapse: collapse; background: white; }
  table th, table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
  table th { background: #f5f5f5; font-size: 0.85rem; }
  .by-size { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .aging-wrap { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.5rem; }
  .risk-ok { color: #10b981; font-weight: 600; }
  .risk-watch { color: #f59e0b; font-weight: 600; }
  .risk-at-risk { color: #f97316; font-weight: 600; }
  .risk-critical { color: #ef4444; font-weight: 700; }
  @media (max-width: 800px) { .charts, .by-size, .aging-wrap { grid-template-columns: 1fr; } }
  .help-wrap { position: relative; display: inline-block; }
  .help-btn {
    background: #e5e7eb; border: none; color: #374151; cursor: pointer;
    width: 18px; height: 18px; border-radius: 50%; font-size: 11px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center;
    margin-left: 0.4rem; vertical-align: middle; padding: 0; line-height: 1;
  }
  .help-wrap:hover .help-btn, .help-btn:focus { background: #2563eb; color: white; }
  .help-popover {
    display: none;
    position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
    background: #1f2937; color: #f5f5f5; padding: 0.7rem 0.9rem; border-radius: 6px;
    width: 280px; font-size: 0.82rem; line-height: 1.45; z-index: 100;
    box-shadow: 0 6px 18px rgba(0,0,0,0.25); text-align: left; font-weight: normal;
    text-transform: none; letter-spacing: 0;
  }
  .help-popover strong { display: block; margin-bottom: 0.35rem; color: #fff; font-size: 0.9rem; }
  .help-popover::after {
    content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-top-color: #1f2937;
  }
  .help-wrap:hover .help-popover, .help-wrap:focus-within .help-popover { display: block; }
</style>
</head>
<body>
<h1>Rapport Lean — ${escapeHtml(input.projectKey)}</h1>
<p class="meta">Généré le ${escapeHtml(input.generatedAt)} · Dernière fenêtre hebdo : ${escapeHtml(input.lastSnapshotDate)}</p>

<h2>État actuel (fenêtre 30j glissante)</h2>
<div class="kpis">
  <div class="kpi"><span class="label">Lead time médian${helpBtn("leadTime")}</span><span class="value">${fmt(input.kpis.leadTimeMedian)}</span></div>
  <div class="kpi"><span class="label">Cycle time médian${helpBtn("cycleTime")}</span><span class="value">${fmt(input.kpis.cycleTimeMedian)}</span></div>
  <div class="kpi"><span class="label">Throughput (7j)${helpBtn("throughput")}</span><span class="value">${fmtInt(input.kpis.throughputCount)}</span></div>
  <div class="kpi"><span class="label">WIP${helpBtn("wip")}</span><span class="value">${fmtInt(input.kpis.wipCount)}</span></div>
  <div class="kpi"><span class="label">Bugs livrés (7j)${helpBtn("bugThroughput")}</span><span class="value">${fmtInt(input.kpis.bugThroughputCount)}</span></div>
  <div class="kpi"><span class="label">Bug cycle médian${helpBtn("bugCycleTime")}</span><span class="value">${fmt(input.kpis.bugCycleTimeMedian)}</span></div>
  <div class="kpi"><span class="label">Flow efficiency${helpBtn("flowEfficiency")}</span><span class="value">${fmtPct(input.kpis.flowEfficiencyAggregate)}</span></div>
</div>

<h2>Tendances hebdomadaires</h2>
<div class="charts">
  <div class="chart-card"><h3>Lead time (jours)${helpBtn("leadTime")}</h3><canvas id="leadTimeChart"></canvas></div>
  <div class="chart-card"><h3>Cycle time (jours)${helpBtn("cycleTime")}</h3><canvas id="cycleTimeChart"></canvas></div>
  <div class="chart-card"><h3>Throughput (issues / 7j)${helpBtn("throughput")}</h3><canvas id="throughputChart"></canvas></div>
  <div class="chart-card"><h3>Throughput pondéré (j-h estimés)${helpBtn("throughputWeighted")}</h3><canvas id="throughputWeightedChart"></canvas></div>
  <div class="chart-card"><h3>WIP (fin de semaine)${helpBtn("wip")}</h3><canvas id="wipChart"></canvas></div>
  <div class="chart-card"><h3>Bugs livrés (issues / 7j)${helpBtn("bugThroughput")}</h3><canvas id="bugThroughputChart"></canvas></div>
  <div class="chart-card"><h3>Bug cycle time (jours)${helpBtn("bugCycleTime")}</h3><canvas id="bugCycleTimeChart"></canvas></div>
  <div class="chart-card"><h3>Cycle normalisé (réel / estimé)${helpBtn("cycleTimeNormalized")}</h3><canvas id="cycleNormalizedChart"></canvas></div>
  <div class="chart-card"><h3>Flow efficiency (ratio)${helpBtn("flowEfficiency")}</h3><canvas id="flowEfficiencyChart"></canvas></div>
</div>

<h2>Distribution cycle time${helpBtn("cycleHistogram")}</h2>
<p class="meta">${input.cycleStats.count} issues · médiane ${input.cycleStats.median.toFixed(1)}j · P85 ${input.cycleStats.p85.toFixed(1)}j · P95 ${input.cycleStats.p95.toFixed(1)}j · moyenne ${input.cycleStats.avg.toFixed(1)}j</p>
<div class="chart-card"><canvas id="cycleHistogramChart" style="max-height: 320px"></canvas></div>

<h2>Forecast Monte Carlo${helpBtn("forecast")}</h2>
<p class="meta">Pool : ${input.forecast.weeksUsed} semaines de throughput récent · ${input.forecast.simulations} simulations</p>
<table>
  <thead><tr><th>Horizon</th><th>P15<br><small>(85% conf.)</small></th><th>P50<br><small>(médiane)</small></th><th>P85</th><th>P95</th></tr></thead>
  <tbody>${forecastTableRows(input.forecast)}</tbody>
</table>

<h2>Aging WIP — au ${escapeHtml(input.agingWip.asOf)}${helpBtn("agingWip")}</h2>
<p class="meta">Seuils cycle-time historique : P50 ${input.agingWip.percentiles.p50.toFixed(1)}j · P85 ${input.agingWip.percentiles.p85.toFixed(1)}j · P95 ${input.agingWip.percentiles.p95.toFixed(1)}j · ${input.agingWip.count} items en cours</p>
<div class="aging-wrap">
  <div class="chart-card"><h3>Distribution âge × statut</h3><canvas id="agingScatter" style="max-height: 360px"></canvas></div>
  <div>
    <h3>Top items par âge</h3>
    <table>
      <thead><tr><th>Issue</th><th>Statut</th><th>Âge</th><th>Risque</th></tr></thead>
      <tbody>${agingTableRows(input.agingWip)}</tbody>
    </table>
  </div>
</div>

<h2>Par taille — fenêtre du ${escapeHtml(input.lastSnapshotDate)}</h2>
<div class="by-size">
  <div>
    <h3>Lead time${helpBtn("leadTimeBySize")}</h3>
    <table><thead><tr><th>Taille</th><th>Count</th><th>Médiane</th><th>P85</th></tr></thead>
    <tbody>${bySizeRows(input.leadBySize)}</tbody></table>
  </div>
  <div>
    <h3>Cycle time${helpBtn("cycleTimeBySize")}</h3>
    <table><thead><tr><th>Taille</th><th>Count</th><th>Médiane</th><th>P85</th></tr></thead>
    <tbody>${bySizeRows(input.cycleBySize)}</tbody></table>
  </div>
</div>

<script>
const CHARTS = ${JSON.stringify(input.charts)};

const COLOR_MEDIAN = "#2563eb";
const COLOR_P85 = "#f59e0b";
const COLOR_COUNT = "#10b981";
const COLOR_DAYS = "#8b5cf6";

const baseOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
  scales: { y: { beginAtZero: true } },
};

function lineChart(canvasId, series, datasets) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !series || series.dates.length === 0) return;
  new Chart(ctx, {
    type: "line",
    data: { labels: series.dates, datasets: datasets.map(d => ({
      label: d.label, data: series.series[d.key], borderColor: d.color,
      backgroundColor: d.color + "22", tension: 0.2, pointRadius: 2,
    })) },
    options: baseOpts,
  });
}

lineChart("leadTimeChart", CHARTS.leadTime, [
  { key: "median", label: "Médiane", color: COLOR_MEDIAN },
  { key: "p85", label: "P85", color: COLOR_P85 },
]);
lineChart("cycleTimeChart", CHARTS.cycleTime, [
  { key: "median", label: "Médiane", color: COLOR_MEDIAN },
  { key: "p85", label: "P85", color: COLOR_P85 },
]);
lineChart("throughputChart", CHARTS.throughput, [
  { key: "count", label: "Issues livrées", color: COLOR_COUNT },
]);
lineChart("throughputWeightedChart", CHARTS.throughputWeighted, [
  { key: "estimatedDays", label: "Jours-personnes", color: COLOR_DAYS },
]);
lineChart("wipChart", CHARTS.wip, [
  { key: "count", label: "WIP", color: COLOR_DAYS },
]);
lineChart("bugThroughputChart", CHARTS.bugThroughput, [
  { key: "count", label: "Bugs", color: "#ef4444" },
]);
lineChart("bugCycleTimeChart", CHARTS.bugCycleTime, [
  { key: "median", label: "Médiane", color: COLOR_MEDIAN },
  { key: "p85", label: "P85", color: COLOR_P85 },
]);
lineChart("cycleNormalizedChart", CHARTS.cycleTimeNormalized, [
  { key: "median", label: "Médiane (ratio)", color: COLOR_MEDIAN },
  { key: "p85", label: "P85 (ratio)", color: COLOR_P85 },
]);
lineChart("flowEfficiencyChart", CHARTS.flowEfficiency, [
  { key: "aggregate", label: "Agrégat (pondéré durée)", color: COLOR_MEDIAN },
  { key: "median", label: "Médiane (par issue)", color: COLOR_P85 },
]);

const HISTOGRAM = ${JSON.stringify(input.histogram)};
const CYCLE_STATS = ${JSON.stringify(input.cycleStats)};
(function renderHistogram() {
  const ctx = document.getElementById("cycleHistogramChart");
  if (!ctx || HISTOGRAM.length === 0) return;
  const labels = HISTOGRAM.map(b => b.start.toFixed(b.start % 1 ? 1 : 0) + "-" + b.end.toFixed(b.end % 1 ? 1 : 0));
  const counts = HISTOGRAM.map(b => b.count);
  new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Issues", data: counts, backgroundColor: "#2563eb88", borderColor: "#2563eb", borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "Cycle time (j ouvrés)" } },
        y: { beginAtZero: true, title: { display: true, text: "Nombre d'issues" } },
      },
    },
    plugins: [{
      id: "pctLines",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const lines = [
          { v: CYCLE_STATS.median, label: "P50", color: "#10b981" },
          { v: CYCLE_STATS.p85, label: "P85", color: "#f59e0b" },
          { v: CYCLE_STATS.p95, label: "P95", color: "#ef4444" },
        ];
        const binWidth = HISTOGRAM[0].end - HISTOGRAM[0].start;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.font = "11px sans-serif";
        for (const l of lines) {
          const idx = l.v / binWidth - 0.5;
          if (idx < 0 || idx > HISTOGRAM.length) continue;
          const x = scales.x.getPixelForValue(idx);
          ctx.strokeStyle = l.color;
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.fillStyle = l.color;
          ctx.fillText(l.label + " " + l.v.toFixed(1) + "j", x + 4, chartArea.top + 12);
        }
        ctx.restore();
      },
    }],
  });
})();

const AGING = ${JSON.stringify({
  issues: input.agingWip.issues,
  percentiles: input.agingWip.percentiles,
})};
(function renderAging() {
  const ctx = document.getElementById("agingScatter");
  if (!ctx || AGING.issues.length === 0) return;
  const colors = { ok: "#10b981", watch: "#f59e0b", "at-risk": "#f97316", critical: "#ef4444" };
  const statuses = [...new Set(AGING.issues.map(i => i.status))];
  const datasets = ["ok", "watch", "at-risk", "critical"].map(risk => ({
    label: risk,
    data: AGING.issues.filter(i => i.riskLevel === risk).map(i => ({
      x: statuses.indexOf(i.status),
      y: i.ageDays,
      key: i.issueKey,
    })),
    backgroundColor: colors[risk],
    pointRadius: 5,
  }));
  const xMax = Math.max(0, statuses.length - 1);
  new Chart(ctx, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: ctx => ctx.raw.key + " : " + ctx.raw.y.toFixed(1) + "j (" + statuses[ctx.raw.x] + ")" } },
        annotation: {},
      },
      scales: {
        x: {
          type: "linear", min: -0.5, max: xMax + 0.5,
          ticks: { stepSize: 1, callback: v => statuses[v] ?? "" },
          title: { display: true, text: "Statut" },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Âge (j ouvrés)" },
        },
      },
    },
    plugins: [{
      id: "ageLines",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const lines = [
          { v: AGING.percentiles.p50, label: "P50", color: "#10b981" },
          { v: AGING.percentiles.p85, label: "P85", color: "#f59e0b" },
          { v: AGING.percentiles.p95, label: "P95", color: "#ef4444" },
        ];
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.font = "11px sans-serif";
        for (const l of lines) {
          const y = scales.y.getPixelForValue(l.v);
          if (y < chartArea.top || y > chartArea.bottom) continue;
          ctx.strokeStyle = l.color;
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.stroke();
          ctx.fillStyle = l.color;
          ctx.fillText(l.label + " " + l.v.toFixed(1) + "j", chartArea.right - 70, y - 4);
        }
        ctx.restore();
      },
    }],
  });
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

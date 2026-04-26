import Database from "better-sqlite3";
import fs from "fs";
import { BUCKET_LABELS, BUCKET_ORDER, SizeBucket } from "../metrics/utils";

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
};

export function generateReport(db: Database.Database, projectKey: string, outputPath: string): void {
  const snapshots = db.prepare(
    "SELECT snapshot_date, metric_name, bucket, stat, value FROM metric_snapshots ORDER BY snapshot_date ASC"
  ).all() as SnapshotRow[];

  if (snapshots.length === 0) {
    throw new Error("Aucun snapshot. Lancer `npm run snapshots` d'abord.");
  }

  const charts = {
    leadTime: buildSeries(snapshots, "lead-time", "", ["median", "p85"]),
    cycleTime: buildSeries(snapshots, "cycle-time", "", ["median", "p85"]),
    throughput: buildSeries(snapshots, "throughput", "", ["count"]),
    throughputWeighted: buildSeries(snapshots, "throughput-weighted", "", ["count", "estimatedDays"]),
    wip: buildSeries(snapshots, "wip", "", ["count"]),
    bugThroughput: buildSeries(snapshots, "bug-throughput", "", ["count"]),
    bugCycleTime: buildSeries(snapshots, "bug-cycle-time", "", ["median", "p85"]),
    leadTimeNormalized: buildSeries(snapshots, "lead-time-normalized", "", ["median", "p85"]),
    cycleTimeNormalized: buildSeries(snapshots, "cycle-time-normalized", "", ["median", "p85"]),
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
  };

  const leadBySize = latestBySize(latestRows, "lead-time-by-size");
  const cycleBySize = latestBySize(latestRows, "cycle-time-by-size");

  const html = renderHtml({
    projectKey,
    generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    lastSnapshotDate: lastDate,
    kpis,
    charts,
    leadBySize,
    cycleBySize,
  });

  fs.writeFileSync(outputPath, html);
}

function buildSeries(snapshots: SnapshotRow[], metric: string, bucket: string, stats: string[]): ChartSeries {
  const dateSet = new Set<string>();
  const byKey = new Map<string, Map<string, number>>();
  for (const stat of stats) byKey.set(stat, new Map());

  for (const s of snapshots) {
    if (s.metric_name !== metric || s.bucket !== bucket) continue;
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

function latestBySize(rows: SnapshotRow[], metric: string): Record<string, BucketStats> {
  const out: Record<string, BucketStats> = {};
  for (const r of rows) {
    if (r.metric_name !== metric) continue;
    if (!out[r.bucket]) out[r.bucket] = { count: 0, median: 0, p85: 0 };
    if (r.stat === "count") out[r.bucket].count = r.value;
    if (r.stat === "median") out[r.bucket].median = r.value;
    if (r.stat === "p85") out[r.bucket].p85 = r.value;
  }
  return out;
}

interface RenderInput {
  projectKey: string;
  generatedAt: string;
  lastSnapshotDate: string;
  kpis: Record<string, number | null>;
  charts: Record<string, ChartSeries>;
  leadBySize: Record<string, BucketStats>;
  cycleBySize: Record<string, BucketStats>;
}

function renderHtml(input: RenderInput): string {
  const fmt = (v: number | null, unit = "j") =>
    v === null ? "—" : `${v.toFixed(1)}<span class="unit">${unit}</span>`;
  const fmtInt = (v: number | null) => (v === null ? "—" : String(Math.round(v)));

  const bySizeRows = (data: Record<string, BucketStats>) =>
    BUCKET_ORDER.map((b) => {
      const s = data[b];
      if (!s || s.count === 0) return "";
      return `<tr><td>${escapeHtml(BUCKET_LABELS[b as SizeBucket])}</td><td>${s.count}</td><td>${s.median.toFixed(1)}j</td><td>${s.p85.toFixed(1)}j</td></tr>`;
    }).join("");

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
  @media (max-width: 800px) { .charts, .by-size { grid-template-columns: 1fr; } }
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
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

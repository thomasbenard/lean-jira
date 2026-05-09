import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { BUCKET_LABELS, BUCKET_ORDER, placeholders } from "../metrics/utils";
import { type MetricConfig } from "../metrics/types";
import { agingWipMetric, type AgingWipSummary, type AgingWipIssue, type AgingRisk } from "../metrics/agingWip";
import { forecastMetric, type ForecastSummary } from "../metrics/forecast";
import { cycleTimeMetric } from "../metrics/cycleTime";
import { scopeChangeMetric, type ScopeChangeResult } from "../metrics/scopeChange";
import { getLastSyncDate } from "../db/store";
import { now } from "../clock";

const STALE_THRESHOLD_DAYS = 7;

export interface ReportPersonalization {
  title?: string;
  logoUrl?: string;
  fontUrl?: string;
  customCssPath?: string;
  excludeTabs?: string[];
}

export interface ResolvedPersonalization {
  title?: string;
  logoDataUri?: string;
  fontLinkHtml?: string;
  customCss?: string;
  excludedTabs: Set<string>;
}

const VALID_TABS = new Set(["delivery", "quality", "roles", "forecast", "advanced"]);
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

export interface ThresholdPair {
  warn: number;
  crit: number;
}

export interface HealthThresholds {
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
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

interface BucketStats {
  count: number;
  median: number;
  p85: number;
}

interface ChartSeries {
  dates: string[];
  series: Record<string, number[]>;
}

const HELP_TEXTS: Record<string, { title: string; body: string } | undefined> = {
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
  devTimeAllocation: {
    title: "Allocation dev : features vs bugs",
    body:
      "Somme des cycle times livrés par semaine, split features (US/TS) vs bugs. " +
      "bugRatio = bugDays / totalDays. Hausse du ratio = dérive vers mode pompier.",
  },
  bugBacklog: {
    title: "Bug backlog",
    body:
      "Nombre de bugs ouverts à la fin de chaque semaine (courbe, axe gauche) et flux net hebdomadaire fermés − créés (barres, axe droit). netFlow > 0 = backlog réduit. netFlow < 0 = backlog grossit.",
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
  stageTimeBreakdown: {
    title: "Stage time breakdown",
    body: "Temps médian passé par chaque rôle (dev/qa/po) sur les tickets cycle-time. Révèle où le temps est consommé dans le flux.",
  },
  wipPerRole: {
    title: "WIP par rôle",
    body: "Nombre de tickets en cours par rôle à chaque fin de semaine. Identifier quel rôle accumule du WIP non limité.",
  },
  stageThroughputGap: {
    title: "Stage throughput gap",
    body: "Flux net (entrées − sorties) par rôle sur la période. Positif = le rôle reçoit plus qu'il ne livre (backlog grossit). Négatif = le rôle écoule son backlog.",
  },
  handoffRework: {
    title: "Handoff rework",
    body: "% tickets avec au moins un retour arrière (qa→dev, po→qa, po→dev) et nombre moyen de reworks. Indicateur de qualité au passage de rôle.",
  },
  firstTimeRight: {
    title: "First-time-right rate",
    body: "% tickets ayant traversé chaque rôle en un seul passage (sans retour). FTR 100% = aucun rework. Complément lisible du handoff-rework.",
  },
  scopeChange: {
    title: "Dérive de périmètre par sprint",
    body:
      "Issues dont la description ou le résumé a changé significativement après le début du sprint. " +
      "Seuil de détection : similarité texte < 85% (Levenshtein normalisé). " +
      "Une dérive élevée corrèle avec des sprints ratés et un cycle time long.",
  },
};

export function generateReport(
  db: Database.Database,
  projectKey: string,
  jiraBaseUrl: string,
  outputPath: string,
  config: MetricConfig,
  healthThresholds?: HealthThresholds,
  squadName?: string,
  personalization?: ReportPersonalization,
  boardDir?: string,
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
    if (arr) {arr.push(s);}
    else {byMetric.set(s.metric_name, [s]);}
  }
  const metricRows = (name: string): SnapshotRow[] => byMetric.get(name) ?? [];

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
    devTimeAllocation: buildSeries(metricRows("dev-time-allocation"), "", ["featureDays", "bugDays", "bugRatio"]),
    bugBacklog: buildSeries(metricRows("bug-backlog"), "", ["openCount", "netFlow"]),
    stageTimeByRole: buildRoleSeries(metricRows("stage-time-breakdown"), ["dev", "qa", "po"], "median"),
    stageTimeByRoleP85: buildRoleSeries(metricRows("stage-time-breakdown"), ["dev", "qa", "po"], "p85"),
    stageTimeShare: buildRoleSeries(metricRows("stage-time-breakdown"), ["dev", "qa", "po"], "avgShare"),
    wipPerRole: buildRoleSeries(metricRows("wip-per-role"), ["dev", "qa", "po"], "count"),
    stageThroughputNet: buildRoleSeries(metricRows("stage-throughput-gap"), ["dev", "qa", "po"], "avgNet"),
    handoffReworkRatio: buildSeries(metricRows("handoff-rework"), "", ["reworkRatio", "avgReworks"]),
    handoffReworkByType: buildRoleSeries(metricRows("handoff-rework"), ["qaToDev", "poToQa", "poDev"], "count"),
    ftrByRole: buildRoleSeries(metricRows("first-time-right"), ["dev", "qa", "po"], "ftrRate"),
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
  const lastSyncAt = getLastSyncDate(db, projectKey);
  const isSyncStale = lastSyncAt === null
    || (Date.now() - new Date(lastSyncAt).getTime()) > STALE_THRESHOLD_DAYS * MS_PER_DAY;

  const agingWip = agingWipMetric.compute(db, config);
  const forecast = forecastMetric.compute(db, config);
  const cycleTime = cycleTimeMetric.compute(db, config);
  const histogram = buildHistogram(cycleTime.issues.map((i) => i.cycleTimeDays));

  let scopeAlertHtml = "";
  let scopeSectionHtml = "";
  if (isScopeChangeAvailable(db)) {
    const scopeData = scopeChangeMetric.compute(db, config);
    scopeAlertHtml = buildScopeAlertBanner(db, scopeData);
    scopeSectionHtml = buildScopeSection(scopeData, db, jiraBaseUrl);
  }

  const resolvedPersonalization = resolvePersonalization(personalization, boardDir ?? process.cwd());

  const html = renderHtml({
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
    healthThresholds,
    scopeAlertHtml,
    scopeSectionHtml,
    personalization: resolvedPersonalization,
  });

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

export function renderHtml(input: RenderInput): string {
  const fmtInt = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));

  const bySizeRows = (data: Partial<Record<string, BucketStats>>): string =>
    BUCKET_ORDER.map((b) => {
      const s = data[b];
      if (!s || s.count === 0) {return "";}
      return `<tr><td>${escapeHtml(BUCKET_LABELS[b])}</td><td>${s.count}</td><td>${s.median.toFixed(1)}j</td><td>${s.p85.toFixed(1)}j</td></tr>`;
    }).join("");

  const forecastTableRows = (data: ForecastSummary): string => {
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

  const helpBtn = (key: string): string => {
    const h = HELP_TEXTS[key];
    if (!h) {return "";}
    return `<span class="help-wrap"><button class="help-btn" aria-label="Aide">?</button><span class="help-popover" role="tooltip"><strong>${escapeHtml(h.title)}</strong>${escapeHtml(h.body)}</span></span>`;
  };

  const thresholds = input.healthThresholds;
  const rawSignals: KpiSignals = {
    leadTime: evalLowerBetter(input.kpis.leadTimeMedian, thresholds?.leadTimeMedianDays),
    cycleTime: evalLowerBetter(input.kpis.cycleTimeMedian, thresholds?.cycleTimeMedianDays),
    throughput: evalHigherBetter(input.kpis.throughputCount, thresholds?.throughputWeekly),
    wip: evalLowerBetter(input.kpis.wipCount, thresholds?.wipCount),
    bugCycle: evalLowerBetter(input.kpis.bugCycleTimeMedian, thresholds?.bugCycleTimeMedianDays),
    bugRatio: evalLowerBetter(input.kpis.devTimeAvgBugRatio, thresholds?.bugRatio),
  };
  const kpiCells = buildKpiCells(input.charts, input.agingWip, rawSignals);
  const verdict = computeVerdict(kpiCells);
  const top3Html = buildTop3Actions(input.agingWip, input.jiraBaseUrl);

  const kpiCellHtml = (c: KpiCell, idx: number): string => {
    const help = c.helpKey ? helpBtn(c.helpKey) : "";
    const unit = c.value !== null && c.unit ? `<span class="unit">${escapeHtml(c.unit)}</span>` : "";
    // pourquoi: data-values est lu côté client par renderSparklines() ; JSON est ASCII-safe pour des nombres,
    // escapeHtml encode les guillemets pour rester valide dans un attribut entre apostrophes.
    const sparkData = JSON.stringify(c.spark);
    return `<div class="kpi-cell ${SIGNAL_CLS[c.signal]}">
      <div class="kpi-label">${escapeHtml(c.label)}${help}</div>
      <div class="kpi-value">${escapeHtml(formatKpiNumber(c.value))}${unit}</div>
      ${fmtDelta(c)}
      <canvas class="spark" id="kpi-spark-${idx}" width="180" height="52" data-values='${escapeHtml(sparkData)}' data-color="${SIGNAL_COLOR[c.signal]}"></canvas>
    </div>`;
  };

  const kpiGridHtml = kpiCells.map(kpiCellHtml).join("");

  const roleCardHtml = (r: { cls: string; name: string; wip: number | null; med: number | null; ftr: number | null }): string =>
    `<div class="role ${r.cls}">
      <h4>${escapeHtml(r.name)}</h4>
      <div class="role-stats">
        <div class="role-stat"><div class="v">${fmtInt(r.wip)}</div><div class="l">WIP</div></div>
        <div class="role-stat"><div class="v">${r.med === null ? "—" : `${r.med.toFixed(1)}j`}</div><div class="l">médiane</div></div>
        <div class="role-stat"><div class="v">${r.ftr === null ? "—" : `${(r.ftr * 100).toFixed(0)}%`}</div><div class="l">FTR</div></div>
      </div>
    </div>`;

  const p = input.personalization;
  const excludedTabs = p?.excludedTabs ?? new Set<string>();
  const ALL_TABS = ["delivery", "quality", "roles", "forecast", "advanced"] as const;
  const visibleTabs = ALL_TABS.filter((t) => !excludedTabs.has(t));
  const firstTab = visibleTabs[0] ?? "delivery";
  const show = (tab: string): boolean => !excludedTabs.has(tab);
  const reportTitle = escapeHtml(p?.title ?? `Rapport Lean — ${input.projectKey}`);
  const headerLabel = escapeHtml(p?.title ?? (input.squadName ? `${input.squadName} (${input.projectKey})` : input.projectKey));
  const fontLink = p?.fontLinkHtml
    ?? `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${reportTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLink}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root {
    --bg: #08090c;
    --panel: #11131a;
    --panel-2: #181b25;
    --line: #1f2330;
    --line-2: #2a2f40;
    --text: #d7dbe6;
    --text-dim: #7a8194;
    --text-faint: #4a5063;
    --cyan: #00e0d4;
    --orange: #ff8a3d;
    --red: #ff4d6a;
    --amber: #ffc24a;
    --green: #4dd697;
    --violet: #a78bff;
    --grid: rgba(255,255,255,0.04);
    --stale-bg: #3d2a00; --stale-border: #f59e0b; --stale-text: #fcd34d;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    background-image:
      linear-gradient(var(--grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 32px 32px;
    background-position: -1px -1px;
    min-height: 100vh;
  }
  .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; font-feature-settings: "tnum" 1; }
  header.bar {
    border-bottom: 1px solid var(--line);
    padding: 0.85rem 2rem;
    display: flex; align-items: center; gap: 1.5rem;
    background: rgba(8,9,12,0.85);
    backdrop-filter: blur(8px);
    position: sticky; top: 0; z-index: 50;
  }
  .logo {
    font-family: "IBM Plex Mono"; font-weight: 600; font-size: 0.85rem;
    color: var(--cyan); letter-spacing: 0.2em;
  }
  .logo::before { content: "▮ "; color: var(--orange); }
  header.bar .meta { color: var(--text-faint); font-size: 0.78rem; font-family: "IBM Plex Mono"; margin-left: auto; }
  main { max-width: 1400px; margin: 0 auto; padding: 1.5rem 2rem 5rem; }

  .stale-warning {
    background: var(--stale-bg); border: 1px solid var(--stale-border); color: var(--stale-text);
    padding: 0.6rem 1rem; border-radius: 6px; margin-bottom: 1.5rem; font-size: 0.9rem;
  }

  .alert-orange {
    background: rgba(255,138,61,0.12); border: 1px solid var(--orange); color: var(--orange);
    padding: 0.7rem 1.2rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem;
  }
  .alert-orange .alert-detail { color: var(--text-dim); margin-left: 0.4rem; }

  .scope-section { margin: 2rem 0; }
  .scope-help { color: var(--text-dim); font-size: 0.85rem; margin: 0.5rem 0 1rem; }
  .scope-issues-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 1rem; }
  .scope-issues-table th { text-align: left; color: var(--text-faint); font-weight: 500; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); cursor: pointer; user-select: none; white-space: nowrap; }
  .scope-issues-table th::after { content: ' ⇅'; font-size: 0.7em; opacity: 0.4; }
  .scope-issues-table th.sort-asc::after { content: ' ↑'; opacity: 1; }
  .scope-issues-table th.sort-desc::after { content: ' ↓'; opacity: 1; }
  .scope-issues-table td { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--line); }
  .text-dim { color: var(--text-dim); font-size: 0.9rem; }

  .verdict {
    border: 1px solid var(--line-2);
    background: linear-gradient(135deg, rgba(255,77,106,0.08), rgba(255,138,61,0.04));
    border-left: 3px solid var(--red);
    padding: 1.2rem 1.5rem;
    display: grid; grid-template-columns: auto 1fr auto; gap: 1.5rem; align-items: center;
  }
  .verdict.alert { border-left-color: var(--red); background: linear-gradient(135deg, rgba(255,77,106,0.08), rgba(255,138,61,0.04)); }
  .verdict.watch { border-left-color: var(--amber); background: linear-gradient(135deg, rgba(255,194,74,0.08), rgba(255,138,61,0.03)); }
  .verdict.ok { border-left-color: var(--green); background: linear-gradient(135deg, rgba(77,214,151,0.08), transparent); }
  .verdict-status {
    font-family: "IBM Plex Mono"; font-weight: 600; font-size: 1.1rem;
    color: var(--red); letter-spacing: 0.06em;
  }
  .verdict.watch .verdict-status { color: var(--amber); }
  .verdict.ok .verdict-status { color: var(--green); }
  .verdict-text { font-size: 0.95rem; color: var(--text); }
  .verdict-text strong { color: #fff; }
  .verdict-time { font-family: "IBM Plex Mono"; font-size: 0.75rem; color: var(--text-faint); }

  section.actions { margin: 1.5rem 0; }
  .actions-head { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.75rem; }
  .actions-head h2 { margin: 0; font-size: 0.85rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--orange); font-weight: 500; }
  .actions-head .sep { flex: 1; height: 1px; background: var(--line); }
  .actions-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .action {
    border: 1px solid var(--line); background: var(--panel); padding: 1rem 1.1rem;
    position: relative; overflow: hidden;
  }
  .action::before {
    content: ""; position: absolute; top: 0; left: 0; width: 3px; height: 100%;
    background: var(--orange);
  }
  .action.crit::before { background: var(--red); }
  .action.warn::before { background: var(--amber); }
  .action.ok::before { background: var(--green); }
  .action-num { font-family: "IBM Plex Mono"; font-size: 0.7rem; color: var(--text-faint); }
  .action-title { font-weight: 600; font-size: 1rem; margin: 0.25rem 0 0.4rem; color: var(--text); }
  .action-detail { font-size: 0.83rem; color: var(--text-dim); }
  .action a { color: var(--cyan); text-decoration: none; font-family: "IBM Plex Mono"; }
  .action a:hover { text-decoration: underline; }

  section.kpi-section { margin: 2rem 0; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid var(--line); }
  .kpi-cell {
    padding: 1.1rem 1.2rem;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    position: relative;
    min-height: 130px;
  }
  .kpi-cell:nth-child(4n) { border-right: none; }
  .kpi-grid > .kpi-cell:nth-last-child(-n+4) { border-bottom: none; }
  .kpi-label { font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-dim); display: flex; align-items: center; gap: 0.5rem; }
  .kpi-label::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); flex-shrink: 0; }
  .kpi-cell.red .kpi-label::before { background: var(--red); box-shadow: 0 0 6px var(--red); }
  .kpi-cell.amber .kpi-label::before { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
  .kpi-cell.green .kpi-label::before { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .kpi-value {
    font-family: "IBM Plex Mono"; font-weight: 500; font-size: 2.2rem;
    line-height: 1.1; margin-top: 0.4rem; color: #fff; letter-spacing: -0.02em;
  }
  .kpi-value .unit { font-size: 0.95rem; color: var(--text-dim); margin-left: 0.2rem; font-weight: 400; }
  .kpi-delta { font-family: "IBM Plex Mono"; font-size: 0.78rem; margin-top: 0.3rem; display: inline-block; }
  .kpi-delta.up.bad, .kpi-delta.down.bad { color: var(--red); }
  .kpi-delta.up.good, .kpi-delta.down.good { color: var(--green); }
  .kpi-delta.flat { color: var(--text-dim); }
  canvas.spark { position: absolute; right: 0.8rem; bottom: 0.8rem; width: 90px; height: 26px; opacity: 0.85; max-width: 90px; max-height: 26px; }

  .tabs { display: flex; gap: 0; margin: 2rem 0 1rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .tab {
    padding: 0.65rem 1.1rem; cursor: pointer; border: none; background: transparent;
    color: var(--text-dim); font-family: "IBM Plex Mono"; font-size: 0.78rem; letter-spacing: 0.12em;
    text-transform: uppercase; font-weight: 500; position: relative; border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--cyan); border-bottom-color: var(--cyan); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  .panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .panel-grid.three { grid-template-columns: 1fr 1fr 1fr; }
  .chart-card {
    background: var(--panel); border: 1px solid var(--line); padding: 1rem 1.2rem;
    position: relative; border-radius: 0;
  }
  .chart-card h3 {
    margin: 0 0 0.8rem 0; font-size: 0.78rem; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--text-dim); font-weight: 500;
  }
  .chart-card canvas { max-height: 220px; }
  .chart-card.wide { grid-column: 1 / -1; }
  .chart-card.wide canvas { max-height: 320px; }
  .meta-line { font-size: 0.8rem; color: var(--text-dim); margin: 0.5rem 0 1rem; font-family: "IBM Plex Mono"; }

  table { width: 100%; border-collapse: collapse; font-family: "IBM Plex Mono"; font-size: 0.82rem; background: var(--panel); }
  th, td { text-align: left; padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--line); }
  th { color: var(--text-dim); font-weight: 500; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.14em; background: var(--panel-2); }
  td a { color: var(--cyan); text-decoration: none; }
  td a:hover { text-decoration: underline; }
  td.risk-critical, .risk-critical { color: var(--red); font-weight: 600; }
  td.risk-at-risk, .risk-at-risk  { color: var(--orange); font-weight: 600; }
  td.risk-watch, .risk-watch    { color: var(--amber); font-weight: 600; }
  td.risk-ok, .risk-ok       { color: var(--green); font-weight: 600; }

  .role-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1rem; }
  .role { background: var(--panel); border: 1px solid var(--line); padding: 1rem 1.1rem; border-top: 2px solid var(--cyan); }
  .role.dev { border-top-color: var(--violet); }
  .role.qa  { border-top-color: var(--green); }
  .role.po  { border-top-color: var(--orange); }
  .role h4 { margin: 0; font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-dim); }
  .role-stats { display: flex; gap: 1.2rem; margin-top: 0.5rem; }
  .role-stat .v { font-family: "IBM Plex Mono"; font-size: 1.4rem; font-weight: 500; color: #fff; }
  .role-stat .l { font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; }

  .bucket-selector { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
  .bucket-btn { padding: 0.25rem 0.6rem; border-radius: 2px; border: 1px solid var(--line); background: var(--panel-2); cursor: pointer; font-size: 0.75rem; color: var(--text-dim); font-family: "IBM Plex Mono"; }
  .bucket-btn.active { background: var(--cyan); color: var(--bg); border-color: var(--cyan); }
  .bucket-btn:disabled { opacity: 0.5; cursor: default; }

  .help-wrap { position: relative; display: inline-block; }
  .help-btn {
    background: var(--panel-2); border: 1px solid var(--line); color: var(--text-dim); cursor: pointer;
    width: 18px; height: 18px; border-radius: 50%; font-size: 11px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center;
    margin-left: 0.4rem; vertical-align: middle; padding: 0; line-height: 1;
  }
  .help-wrap:hover .help-btn, .help-btn:focus { background: var(--cyan); color: var(--bg); border-color: var(--cyan); }
  .help-popover {
    display: none;
    position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
    background: #0c0d12; color: var(--text); padding: 0.7rem 0.9rem; border-radius: 4px;
    border: 1px solid var(--line-2);
    width: 280px; font-size: 0.82rem; line-height: 1.45; z-index: 100;
    box-shadow: 0 6px 18px rgba(0,0,0,0.6); text-align: left; font-weight: normal;
    text-transform: none; letter-spacing: 0;
  }
  .help-popover strong { display: block; margin-bottom: 0.35rem; color: var(--cyan); font-size: 0.9rem; font-family: "IBM Plex Mono"; }
  .help-popover::after {
    content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-top-color: #0c0d12;
  }
  .help-wrap:hover .help-popover, .help-wrap:focus-within .help-popover { display: block; }

  .zoom-btn {
    position: absolute; top: 0.55rem; right: 0.55rem;
    background: var(--panel-2); border: 1px solid var(--line); color: var(--text-dim);
    cursor: pointer; border-radius: 2px; padding: 0.15rem 0.4rem; font-size: 0.85rem;
    line-height: 1.4; opacity: 0.55; z-index: 1;
  }
  .zoom-btn:hover { opacity: 1; background: var(--cyan); color: var(--bg); border-color: var(--cyan); }
  .chart-modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.78);
    z-index: 2000; align-items: center; justify-content: center;
  }
  .chart-modal-overlay.open { display: flex; }
  .chart-modal {
    background: var(--panel); border: 1px solid var(--line-2); border-radius: 4px; padding: 1.25rem 1.5rem 1.5rem;
    width: 92vw; max-width: 1300px; max-height: 92vh;
    display: flex; flex-direction: column; gap: 0.75rem;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  }
  .chart-modal-header { display: flex; justify-content: space-between; align-items: center; min-height: 1.8rem; }
  .chart-modal-title { font-weight: 600; font-size: 1rem; color: var(--text); font-family: "IBM Plex Mono"; }
  .chart-modal-close {
    background: var(--panel-2); border: 1px solid var(--line); color: var(--text-dim);
    cursor: pointer; border-radius: 2px; padding: 0.25rem 0.6rem; font-size: 1rem; line-height: 1.2;
    flex-shrink: 0;
  }
  .chart-modal-close:hover { background: var(--red); color: #fff; border-color: var(--red); }
  .chart-modal-canvas-wrap { flex: 1; min-height: 0; height: 75vh; position: relative; }
  .chart-modal-canvas-wrap canvas { max-height: none !important; width: 100% !important; height: 100% !important; }
  .chart-modal-desc { font-size: 0.82rem; color: var(--text-dim); line-height: 1.45; margin: 0; padding-bottom: 0.25rem; border-bottom: 1px solid var(--line); }

  @media (max-width: 1100px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    .kpi-cell { border-right: 1px solid var(--line); }
    .kpi-cell:nth-child(2n) { border-right: none; }
    .kpi-grid > .kpi-cell:nth-last-child(-n+4) { border-bottom: 1px solid var(--line); }
    .kpi-grid > .kpi-cell:nth-last-child(-n+2) { border-bottom: none; }
    .actions-grid, .role-grid, .panel-grid, .panel-grid.three { grid-template-columns: 1fr; }
    main { padding: 1rem 1rem 4rem; }
  }
</style>
${p?.customCss ? `<style>\n${p.customCss}\n</style>` : ""}
</head>
<body>
<header class="bar">
  <span class="logo">${p?.logoDataUri ? `<img src="${p.logoDataUri}" alt="logo" style="height:28px;vertical-align:middle;margin-right:.5rem;">` : ""}${headerLabel} // FLOW.OPS</span>
  <span class="meta">GEN ${escapeHtml(input.generatedAt)} · SNAPSHOT ${escapeHtml(input.lastSnapshotDate)} · ${escapeHtml(syncMetaLabel(input.lastSyncAt))}</span>
</header>
<main>
<div class="verdict ${verdict.status}">
  <span class="verdict-status">${escapeHtml(VERDICT_LABELS[verdict.status])}</span>
  <span class="verdict-text">${verdict.phrase}</span>
  <span class="verdict-time mono">${escapeHtml(syncMetaLabel(input.lastSyncAt))} · Snapshot ${escapeHtml(input.lastSnapshotDate)}</span>
</div>

${staleBannerHtml(input.isSyncStale, input.lastSyncAt)}
${input.scopeAlertHtml ?? ""}

<section class="actions">
  <div class="actions-head"><h2>À traiter // top 3</h2><div class="sep"></div></div>
  <div class="actions-grid">${top3Html}</div>
</section>

<section class="kpi-section">
  <div class="actions-head"><h2>Indicateurs clés</h2><div class="sep"></div></div>
  <div class="kpi-grid">${kpiGridHtml}</div>
</section>

${(visibleTabs.length > 0 || !!input.scopeSectionHtml) ? `<div class="tabs" id="tabs">
  ${show("delivery") ? `<button class="tab${firstTab === "delivery" ? " active" : ""}" data-tab="delivery">Livraison</button>` : ""}
  ${show("quality") ? `<button class="tab${firstTab === "quality" ? " active" : ""}" data-tab="quality">Qualité &amp; bugs</button>` : ""}
  ${show("roles") ? `<button class="tab${firstTab === "roles" ? " active" : ""}" data-tab="roles">Flux par rôle</button>` : ""}
  ${show("forecast") ? `<button class="tab${firstTab === "forecast" ? " active" : ""}" data-tab="forecast">Forecast &amp; aging</button>` : ""}
  ${input.scopeSectionHtml ? `<button class="tab" data-tab="scope">Dérive de périmètre</button>` : ""}
  ${show("advanced") ? `<button class="tab${firstTab === "advanced" ? " active" : ""}" data-tab="advanced">Avancé</button>` : ""}
</div>` : ""}

${show("delivery") ? `<div class="tab-panel${firstTab === "delivery" ? " active" : ""}" id="tab-delivery">
  <div class="panel-grid">
    <div class="chart-card"><h3>Lead time (jours)${helpBtn("leadTime")}</h3><canvas id="leadTimeChart"></canvas></div>
    <div class="chart-card"><h3>Cycle time (jours)${helpBtn("cycleTime")}</h3><canvas id="cycleTimeChart"></canvas></div>
    <div class="chart-card"><h3>Throughput (issues / 7j)${helpBtn("throughput")}</h3><canvas id="throughputChart"></canvas></div>
    <div class="chart-card"><h3>Throughput pondéré (j-h estimés)${helpBtn("throughputWeighted")}</h3><canvas id="throughputWeightedChart"></canvas></div>
    <div class="chart-card"><h3>WIP (fin de semaine)${helpBtn("wip")}</h3><canvas id="wipChart"></canvas></div>
    <div class="chart-card wide">
      <h3>Distribution cycle time${helpBtn("cycleHistogram")}</h3>
      <p class="meta-line">${input.cycleStats.count} issues · médiane ${input.cycleStats.median.toFixed(1)}j · P85 ${input.cycleStats.p85.toFixed(1)}j · P95 ${input.cycleStats.p95.toFixed(1)}j · moyenne ${input.cycleStats.avg.toFixed(1)}j</p>
      <canvas id="cycleHistogramChart"></canvas>
    </div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card">
      <h3>Lead time par taille — fenêtre du ${escapeHtml(input.lastSnapshotDate)}${helpBtn("leadTimeBySize")}</h3>
      <table><thead><tr><th>Taille</th><th>Count</th><th>Médiane</th><th>P85</th></tr></thead>
      <tbody>${bySizeRows(input.leadBySize)}</tbody></table>
    </div>
    <div class="chart-card">
      <h3>Cycle time par taille${helpBtn("cycleTimeBySize")}</h3>
      <table><thead><tr><th>Taille</th><th>Count</th><th>Médiane</th><th>P85</th></tr></thead>
      <tbody>${bySizeRows(input.cycleBySize)}</tbody></table>
    </div>
  </div>
</div>` : ""}

${show("quality") ? `<div class="tab-panel${firstTab === "quality" ? " active" : ""}" id="tab-quality">
  <div class="panel-grid">
    <div class="chart-card"><h3>Bugs livrés (issues / 7j)${helpBtn("bugThroughput")}</h3><canvas id="bugThroughputChart"></canvas></div>
    <div class="chart-card"><h3>Bug cycle time (jours)${helpBtn("bugCycleTime")}</h3><canvas id="bugCycleTimeChart"></canvas></div>
    <div class="chart-card"><h3>Allocation dev : features vs bugs${helpBtn("devTimeAllocation")}</h3><canvas id="devTimeAllocationChart"></canvas></div>
    <div class="chart-card"><h3>Bug backlog${helpBtn("bugBacklog")}</h3><canvas id="bugBacklogChart"></canvas></div>
  </div>
</div>` : ""}

${show("roles") ? `<div class="tab-panel${firstTab === "roles" ? " active" : ""}" id="tab-roles">
  <div class="role-grid">
    ${roleCardHtml({ cls: "dev", name: "Dev", wip: input.kpis.wipDev, med: input.kpis.stageTimeDevMedian, ftr: input.kpis.ftrDev })}
    ${roleCardHtml({ cls: "qa",  name: "QA",  wip: input.kpis.wipQa, med: input.kpis.stageTimeQaMedian, ftr: input.kpis.ftrQa })}
    ${roleCardHtml({ cls: "po",  name: "PO",  wip: input.kpis.wipPo, med: input.kpis.stageTimePoMedian, ftr: input.kpis.ftrPo })}
  </div>
  <div class="panel-grid">
    <div class="chart-card"><h3>Temps médian par rôle${helpBtn("stageTimeBreakdown")}</h3><canvas id="stageTimeByRoleChart"></canvas></div>
    <div class="chart-card"><h3>Répartition cycle time${helpBtn("stageTimeBreakdown")}</h3><canvas id="stageTimeShareChart"></canvas></div>
    <div class="chart-card"><h3>WIP par rôle${helpBtn("wipPerRole")}</h3><canvas id="wipPerRoleChart"></canvas></div>
    <div class="chart-card"><h3>Throughput net par rôle${helpBtn("stageThroughputGap")}</h3><canvas id="stageThroughputGapChart"></canvas></div>
    <div class="chart-card"><h3>FTR par rôle${helpBtn("firstTimeRight")}</h3><canvas id="ftrByRoleChart"></canvas></div>
    <div class="chart-card"><h3>Taux de rework${helpBtn("handoffRework")}</h3><canvas id="reworkRatioChart"></canvas></div>
    <div class="chart-card wide"><h3>Reworks par type${helpBtn("handoffRework")}</h3><canvas id="reworkByTypeChart"></canvas></div>
  </div>
</div>` : ""}

${show("forecast") ? `<div class="tab-panel${firstTab === "forecast" ? " active" : ""}" id="tab-forecast">
  <div class="panel-grid">
    <div class="chart-card">
      <h3>Forecast Monte Carlo${helpBtn("forecast")}</h3>
      <p class="meta-line">Pool : ${input.forecast.weeksUsed} semaines · ${input.forecast.simulations} simulations</p>
      <table>
        <thead><tr><th>Horizon</th><th>P15<br><small>(85% conf.)</small></th><th>P50</th><th>P85</th><th>P95</th></tr></thead>
        <tbody>${forecastTableRows(input.forecast)}</tbody>
      </table>
    </div>
    <div class="chart-card">
      <h3>Aging WIP — au ${escapeHtml(input.agingWip.asOf)}${helpBtn("agingWip")}</h3>
      <p class="meta-line">P50 ${input.agingWip.percentiles.p50.toFixed(1)}j · P85 ${input.agingWip.percentiles.p85.toFixed(1)}j · P95 ${input.agingWip.percentiles.p95.toFixed(1)}j · ${input.agingWip.count} en cours</p>
      <canvas id="agingScatter"></canvas>
    </div>
    <div class="chart-card wide">
      <h3>Top items par âge${helpBtn("agingWip")}</h3>
      <table>
        <thead><tr><th>Issue</th><th>Statut</th><th>Âge</th><th>Risque</th></tr></thead>
        <tbody>${agingRowsHtml(input.agingWip, input.jiraBaseUrl)}</tbody>
      </table>
    </div>
  </div>
</div>` : ""}

${input.scopeSectionHtml ? `<div class="tab-panel" id="tab-scope">${input.scopeSectionHtml}</div>` : ""}

${show("advanced") ? `<div class="tab-panel${firstTab === "advanced" ? " active" : ""}" id="tab-advanced">
  <div class="panel-grid three">
    <div class="chart-card"><h3>Lead normalisé (réel / estimé)${helpBtn("leadTimeNormalized")}</h3><canvas id="leadNormalizedChart"></canvas></div>
    <div class="chart-card"><h3>Cycle normalisé (réel / estimé)${helpBtn("cycleTimeNormalized")}</h3><canvas id="cycleNormalizedChart"></canvas></div>
    <div class="chart-card"><h3>Flow efficiency (ratio)${helpBtn("flowEfficiency")}</h3><canvas id="flowEfficiencyChart"></canvas></div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card">
      <h3>Lead time par taille (jours)${helpBtn("leadTimeBySize")}</h3>
      <div class="bucket-selector" id="leadBySizeBuckets"></div>
      <canvas id="leadBySizeChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Cycle time par taille (jours)${helpBtn("cycleTimeBySize")}</h3>
      <div class="bucket-selector" id="cycleBySizeBuckets"></div>
      <canvas id="cycleBySizeChart"></canvas>
    </div>
  </div>
</div>` : ""}

</main>

<script>
Chart.defaults.color = '#7a8194';
Chart.defaults.borderColor = '#1f2330';
Chart.defaults.font.family = "'IBM Plex Mono', ui-monospace, monospace";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip.backgroundColor = '#0c0d12';
Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
Chart.defaults.plugins.tooltip.bodyColor = '#d7dbe6';
Chart.defaults.plugins.tooltip.borderColor = '#2a2f40';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 8;

(function renderSparklines() {
  document.querySelectorAll('canvas.spark').forEach(function(canvas) {
    const raw = canvas.getAttribute('data-values');
    if (!raw) return;
    let values;
    try { values = JSON.parse(raw); } catch (_) { return; }
    if (!Array.isArray(values) || values.length === 0) return;
    const color = canvas.getAttribute('data-color') || '#7a8194';
    new Chart(canvas, {
      type: 'line',
      data: { labels: values.map(function(_, i) { return i; }), datasets: [{
        data: values, borderColor: color, backgroundColor: color + '22',
        borderWidth: 1.4, pointRadius: 0, fill: true, tension: 0.35,
      }] },
      options: {
        responsive: false, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  });
})();

(function initTabs() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  tabs.addEventListener('click', function(e) {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const id = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('active', t === btn); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.toggle('active', p.id === 'tab-' + id); });
  });
})();

const CHARTS = ${JSON.stringify(input.charts)};

const COLOR_MEDIAN = "#00e0d4";
const COLOR_P85 = "#ff8a3d";
const COLOR_P95 = "#ff4d6a";
const COLOR_COUNT = "#4dd697";
const COLOR_DAYS = "#a78bff";

const _gridColor = 'rgba(255,255,255,0.04)';
const _tickColor = '#7a8194';
const baseOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
  scales: { y: { beginAtZero: true, grid: { color: _gridColor }, ticks: { color: _tickColor } } },
};

function computeMovingAvg(values, windowSize = 4) {
  return values.map((_, i) => {
    if (i < windowSize - 1) return null;
    const slice = values.slice(i - windowSize + 1, i + 1);
    return Math.round(slice.reduce((a, b) => a + b, 0) / windowSize * 100) / 100;
  });
}

function buildTrendDataset(trendData) {
  if (!trendData.some(v => v !== null)) return null;
  return {
    label: "Tendance",
    data: trendData,
    borderColor: "#64748b88",
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderDash: [6, 4],
    tension: 0,
    pointRadius: 0,
    fill: false,
  };
}

function lineChart(canvasId, series, datasets, withTrend = false) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !series || series.dates.length === 0) return;
  const builtDatasets = datasets.map(d => ({
    label: d.label, data: series.series[d.key], borderColor: d.color,
    backgroundColor: d.color + "22", tension: 0.2, pointRadius: 2,
  }));
  if (withTrend) {
    const trend = buildTrendDataset(computeMovingAvg(series.series[datasets[0].key] ?? []));
    if (trend) builtDatasets.push(trend);
  }
  new Chart(ctx, {
    type: "line",
    data: { labels: series.dates, datasets: builtDatasets },
    options: baseOpts,
  });
}

lineChart("leadTimeChart", CHARTS.leadTime, [
  { key: "median", label: "Médiane", color: COLOR_MEDIAN },
  { key: "p85", label: "P85", color: COLOR_P85 },
], true);
lineChart("cycleTimeChart", CHARTS.cycleTime, [
  { key: "median", label: "Médiane", color: COLOR_MEDIAN },
  { key: "p85", label: "P85", color: COLOR_P85 },
], true);
lineChart("throughputChart", CHARTS.throughput, [
  { key: "count", label: "Issues livrées", color: COLOR_COUNT },
], true);
lineChart("throughputWeightedChart", CHARTS.throughputWeighted, [
  { key: "estimatedDays", label: "Jours-personnes", color: COLOR_DAYS },
], true);
lineChart("wipChart", CHARTS.wip, [
  { key: "count", label: "WIP", color: COLOR_DAYS },
], true);
lineChart("bugThroughputChart", CHARTS.bugThroughput, [
  { key: "count", label: "Bugs", color: "#ef4444" },
], true);
lineChart("bugCycleTimeChart", CHARTS.bugCycleTime, [
  { key: "median", label: "Médiane", color: COLOR_MEDIAN },
  { key: "p85", label: "P85", color: COLOR_P85 },
], true);
lineChart("cycleNormalizedChart", CHARTS.cycleTimeNormalized, [
  { key: "median", label: "Médiane (ratio)", color: COLOR_MEDIAN },
  { key: "p85", label: "P85 (ratio)", color: COLOR_P85 },
], true);
lineChart("leadNormalizedChart", CHARTS.leadTimeNormalized, [
  { key: "median", label: "Médiane (ratio)", color: COLOR_MEDIAN },
  { key: "p85", label: "P85 (ratio)", color: COLOR_P85 },
], true);
lineChart("flowEfficiencyChart", CHARTS.flowEfficiency, [
  { key: "aggregate", label: "Agrégat (pondéré durée)", color: COLOR_MEDIAN },
  { key: "median", label: "Médiane (par issue)", color: COLOR_P85 },
], true);

(function renderDevTimeAllocation() {
  const series = CHARTS.devTimeAllocation;
  const ctx = document.getElementById("devTimeAllocationChart");
  if (!ctx || !series || series.dates.length === 0) return;
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: series.dates,
      datasets: [
        {
          label: "Features (j ouvrés)",
          data: series.series["featureDays"],
          backgroundColor: "#2563eb88",
          borderColor: "#2563eb",
          borderWidth: 1,
          stack: "days",
          yAxisID: "y",
        },
        {
          label: "Bugs (j ouvrés)",
          data: series.series["bugDays"],
          backgroundColor: "#ef444488",
          borderColor: "#ef4444",
          borderWidth: 1,
          stack: "days",
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Bug ratio (%)",
          data: (series.series["bugRatio"] ?? []).map(v => v * 100),
          borderColor: "#f97316",
          backgroundColor: "transparent",
          tension: 0.2,
          pointRadius: 2,
          yAxisID: "y2",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: "Jours ouvrés" } },
        y2: {
          position: "right",
          beginAtZero: true,
          max: 100,
          title: { display: true, text: "Bug ratio (%)" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
})();

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

const LEAD_BY_SIZE = ${JSON.stringify(input.leadTimeBySizeCharts)};
const CYCLE_BY_SIZE = ${JSON.stringify(input.cycleTimeBySizeCharts)};
const BUCKET_LABELS_MAP = ${JSON.stringify(BUCKET_LABELS)};

function initBucketSelector(dataByBucket, canvasId, selectorId) {
  const buckets = Object.keys(dataByBucket);
  if (buckets.length === 0) return;

  const lastCount = (bkt) => { const c = dataByBucket[bkt].series.count; return c[c.length - 1] ?? 0; };
  let activeBucket = buckets.reduce((a, b) => lastCount(a) >= lastCount(b) ? a : b);

  const selectorEl = document.getElementById(selectorId);
  const canvasEl = document.getElementById(canvasId);
  let chart = null;
  const singleBucket = buckets.length === 1;

  selectorEl.innerHTML = buckets.map(b =>
    '<button class="bucket-btn' + (b === activeBucket ? ' active' : '') + '"' + (singleBucket ? ' disabled' : '') + ' data-bucket="' + b + '">' + (BUCKET_LABELS_MAP[b] ?? b) + '</button>'
  ).join('');

  selectorEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.bucket-btn');
    if (!btn || btn.disabled) return;
    activeBucket = btn.dataset.bucket;
    selectorEl.querySelectorAll('.bucket-btn').forEach(b => b.classList.toggle('active', b.dataset.bucket === activeBucket));
    renderChart();
  });

  function renderChart() {
    const data = dataByBucket[activeBucket];
    if (chart) chart.destroy();
    const trend = buildTrendDataset(computeMovingAvg(data.series.median ?? []));
    chart = new Chart(canvasEl, {
      type: 'line',
      data: {
        labels: data.dates,
        datasets: [
          { label: 'P50', data: data.series.median, borderColor: COLOR_MEDIAN, backgroundColor: COLOR_MEDIAN + '22', tension: 0.2, pointRadius: 2 },
          { label: 'P85', data: data.series.p85,    borderColor: COLOR_P85,    backgroundColor: COLOR_P85    + '22', tension: 0.2, pointRadius: 2 },
          { label: 'P95', data: data.series.p95,    borderColor: COLOR_P95,    backgroundColor: COLOR_P95    + '22', tension: 0.2, pointRadius: 2 },
          ...(trend ? [trend] : []),
        ],
      },
      options: baseOpts,
    });
  }

  renderChart();
}

initBucketSelector(LEAD_BY_SIZE,  'leadBySizeChart',  'leadBySizeBuckets');
initBucketSelector(CYCLE_BY_SIZE, 'cycleBySizeChart', 'cycleBySizeBuckets');

(function renderBugBacklog() {
  const series = CHARTS.bugBacklog;
  const ctx = document.getElementById("bugBacklogChart");
  if (!ctx || !series || series.dates.length === 0) return;
  const netFlows = series.series["netFlow"] ?? [];
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: series.dates,
      datasets: [
        {
          type: "bar",
          label: "Flux net (fermés − créés)",
          data: netFlows,
          backgroundColor: netFlows.map(v => v >= 0 ? "#10b98188" : "#ef444488"),
          borderColor: netFlows.map(v => v >= 0 ? "#10b981" : "#ef4444"),
          borderWidth: 1,
          yAxisID: "y2",
        },
        {
          type: "line",
          label: "Bugs ouverts",
          data: series.series["openCount"] ?? [],
          borderColor: "#2563eb",
          backgroundColor: "#2563eb22",
          tension: 0.2,
          pointRadius: 2,
          yAxisID: "y",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Bugs ouverts" } },
        y2: {
          position: "right",
          title: { display: true, text: "Flux net" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
})();

const COLOR_DEV = "#2563eb";
const COLOR_QA  = "#10b981";
const COLOR_PO  = "#f59e0b";

lineChart("wipPerRoleChart", CHARTS.wipPerRole, [
  { key: "dev", label: "WIP dev", color: COLOR_DEV },
  { key: "qa",  label: "WIP qa",  color: COLOR_QA  },
  { key: "po",  label: "WIP po",  color: COLOR_PO  },
]);

lineChart("ftrByRoleChart", CHARTS.ftrByRole, [
  { key: "dev", label: "FTR dev", color: COLOR_DEV },
  { key: "qa",  label: "FTR qa",  color: COLOR_QA  },
  { key: "po",  label: "FTR po",  color: COLOR_PO  },
]);

lineChart("reworkRatioChart", CHARTS.handoffReworkRatio, [
  { key: "reworkRatio", label: "Taux de rework", color: "#ef4444" },
], true);

(function renderStageTimeByRole() {
  const ctx = document.getElementById("stageTimeByRoleChart");
  if (!ctx || !CHARTS.stageTimeByRole || CHARTS.stageTimeByRole.dates.length === 0) return;
  const dates = CHARTS.stageTimeByRole.dates;
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: dates,
      datasets: [
        { label: "Dev P50", data: CHARTS.stageTimeByRole.series["dev"],    backgroundColor: COLOR_DEV + "88", borderColor: COLOR_DEV, borderWidth: 1 },
        { label: "Dev P85", data: CHARTS.stageTimeByRoleP85.series["dev"], backgroundColor: COLOR_DEV + "44", borderColor: COLOR_DEV, borderWidth: 1 },
        { label: "QA P50",  data: CHARTS.stageTimeByRole.series["qa"],     backgroundColor: COLOR_QA  + "88", borderColor: COLOR_QA,  borderWidth: 1 },
        { label: "QA P85",  data: CHARTS.stageTimeByRoleP85.series["qa"],  backgroundColor: COLOR_QA  + "44", borderColor: COLOR_QA,  borderWidth: 1 },
        { label: "PO P50",  data: CHARTS.stageTimeByRole.series["po"],     backgroundColor: COLOR_PO  + "88", borderColor: COLOR_PO,  borderWidth: 1 },
        { label: "PO P85",  data: CHARTS.stageTimeByRoleP85.series["po"],  backgroundColor: COLOR_PO  + "44", borderColor: COLOR_PO,  borderWidth: 1 },
      ],
    },
    options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, title: { display: true, text: "Jours ouvrés" } } } },
  });
})();

(function renderStageTimeShare() {
  const ctx = document.getElementById("stageTimeShareChart");
  const share = CHARTS.stageTimeShare;
  if (!ctx || !share || share.dates.length === 0) return;
  const lastIdx = share.dates.length - 1;
  const devShare = share.series["dev"][lastIdx] ?? 0;
  const qaShare  = share.series["qa"][lastIdx]  ?? 0;
  const poShare  = share.series["po"][lastIdx]  ?? 0;
  if (devShare + qaShare + poShare === 0) return;
  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Dev", "QA", "PO"],
      datasets: [{ data: [devShare, qaShare, poShare], backgroundColor: [COLOR_DEV, COLOR_QA, COLOR_PO] }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });
})();

(function renderStageThroughputGap() {
  const ctx = document.getElementById("stageThroughputGapChart");
  if (!ctx || !CHARTS.stageThroughputNet || CHARTS.stageThroughputNet.dates.length === 0) return;
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: CHARTS.stageThroughputNet.dates,
      datasets: [
        { label: "Dev net", data: CHARTS.stageThroughputNet.series["dev"], backgroundColor: COLOR_DEV + "88", borderColor: COLOR_DEV, borderWidth: 1 },
        { label: "QA net",  data: CHARTS.stageThroughputNet.series["qa"],  backgroundColor: COLOR_QA  + "88", borderColor: COLOR_QA,  borderWidth: 1 },
        { label: "PO net",  data: CHARTS.stageThroughputNet.series["po"],  backgroundColor: COLOR_PO  + "88", borderColor: COLOR_PO,  borderWidth: 1 },
      ],
    },
    options: { ...baseOpts, scales: { ...baseOpts.scales, y: { beginAtZero: false, grid: { color: _gridColor }, ticks: { color: _tickColor } } } },
  });
})();

(function renderReworkByType() {
  const ctx = document.getElementById("reworkByTypeChart");
  const series = CHARTS.handoffReworkByType;
  if (!ctx || !series || series.dates.length === 0) return;
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: series.dates,
      datasets: [
        { label: "QA→Dev", data: series.series["qaToDev"] ?? [], backgroundColor: "#ef444488", borderColor: "#ef4444", borderWidth: 1 },
        { label: "PO→QA",  data: series.series["poToQa"]  ?? [], backgroundColor: "#f9731688", borderColor: "#f97316", borderWidth: 1 },
        { label: "PO→Dev", data: series.series["poDev"]   ?? [], backgroundColor: "#a855f788", borderColor: "#a855f7", borderWidth: 1 },
      ],
    },
    options: baseOpts,
  });
})();

// Modal zoom
(function initZoom() {
  const HELP_BODIES = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(HELP_TEXTS).map(([k, v]) => [k, v?.body ?? ""])
    )
  )};
  const CANVAS_KEY = {
    leadTimeChart: "leadTime", cycleTimeChart: "cycleTime",
    throughputChart: "throughput", throughputWeightedChart: "throughputWeighted",
    wipChart: "wip", bugThroughputChart: "bugThroughput",
    bugCycleTimeChart: "bugCycleTime", cycleHistogramChart: "cycleHistogram",
    leadNormalizedChart: "leadTimeNormalized", cycleNormalizedChart: "cycleTimeNormalized",
    flowEfficiencyChart: "flowEfficiency", leadBySizeChart: "leadTimeBySize",
    cycleBySizeChart: "cycleTimeBySize", agingScatter: "agingWip",
    devTimeAllocationChart: "devTimeAllocation", bugBacklogChart: "bugBacklog",
    stageTimeByRoleChart: "stageTimeBreakdown", stageTimeShareChart: "stageTimeBreakdown",
    wipPerRoleChart: "wipPerRole", stageThroughputGapChart: "stageThroughputGap",
    reworkRatioChart: "handoffRework", reworkByTypeChart: "handoffRework",
    ftrByRoleChart: "firstTimeRight",
  };

  document.body.insertAdjacentHTML('beforeend', [
    '<div class="chart-modal-overlay" id="chartModal" role="dialog" aria-modal="true">',
    '<div class="chart-modal">',
    '<div class="chart-modal-header">',
    '<span class="chart-modal-title" id="chartModalTitle"></span>',
    '<button class="chart-modal-close" id="chartModalClose" aria-label="Fermer">✕</button>',
    '</div>',
    '<p class="chart-modal-desc" id="chartModalDesc"></p>',
    '<div class="chart-modal-canvas-wrap"><canvas id="chartModalCanvas"></canvas></div>',
    '</div></div>',
  ].join(''));

  let modalChart = null;
  const overlay = document.getElementById('chartModal');
  const modalTitle = document.getElementById('chartModalTitle');
  const modalDesc = document.getElementById('chartModalDesc');
  const modalClose = document.getElementById('chartModalClose');
  const modalCanvas = document.getElementById('chartModalCanvas');

  function openModal(sourceCanvasId, title) {
    const src = Chart.getChart(sourceCanvasId);
    if (!src) return;
    modalTitle.textContent = title;
    const desc = HELP_BODIES[CANVAS_KEY[sourceCanvasId] ?? ''] ?? '';
    modalDesc.textContent = desc;
    modalDesc.style.display = desc ? '' : 'none';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (modalChart) { modalChart.destroy(); modalChart = null; }
    const cfg = src.config._config;
    modalChart = new Chart(modalCanvas, {
      type: cfg.type,
      data: JSON.parse(JSON.stringify(cfg.data)),
      options: Object.assign(JSON.parse(JSON.stringify(cfg.options ?? {})), { responsive: true, maintainAspectRatio: false }),
      plugins: cfg.plugins,
    });
  }

  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  }

  modalClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });

  document.querySelectorAll('.chart-card').forEach(function(card) {
    const canvas = card.querySelector('canvas');
    if (!canvas || !canvas.id) return;
    const h3 = card.querySelector('h3');
    const title = h3 ? Array.from(h3.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim() : '';
    const btn = document.createElement('button');
    btn.className = 'zoom-btn';
    btn.title = 'Agrandir';
    btn.textContent = '⤢';
    btn.setAttribute('aria-label', 'Agrandir ce graphe');
    btn.addEventListener('click', function() { openModal(canvas.id, title); });
    card.appendChild(btn);
  });
})();
</script>
</body>
</html>`;
}

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
  if (!lastSyncAt) {return "Données Jira : jamais synchronisé";}
  return `Données Jira du ${lastSyncAt.slice(0, 16).replace("T", " ")}`;
}

// exporté pour tests unitaires — évite de parser le HTML complet dans les tests
export function staleBannerHtml(isSyncStale: boolean, lastSyncAt: string | null): string {
  if (!isSyncStale) {return "";}
  const syncRef = lastSyncAt ? `le ${lastSyncAt.slice(0, 10)}` : "jamais effectué";
  return `<div class="stale-warning">⚠ Données potentiellement périmées — dernier sync ${syncRef}. Lancer npm run sync.</div>`;
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
    return `<tr><td colspan="4">Aucun item en cours.</td></tr>`;
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

const VERDICT_LABELS: Record<VerdictStatus, string> = {
  alert: "⚠ ALERTE",
  watch: "◐ VIGILANCE",
  ok: "✓ SAIN",
};

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
    return { status: "ok", phrase: "Tous les indicateurs dans la zone verte." };
  }
  const dominants = (reds.length > 0 ? reds : oranges).slice(0, VERDICT_PHRASE_LIMIT);
  const parts = dominants.map(
    (c) => `${escapeHtml(c.label)} <strong>${escapeHtml(fmtCellValueWithUnit(c))}</strong>`,
  );
  const verbe = reds.length > 0 ? "au-dessus du seuil critique" : "en zone de vigilance";
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
    return `<div class="action ok"><div class="action-num">// 01</div><div class="action-title">✓ Aucun ticket en zone critique</div><div class="action-detail">Aucun item ne dépasse le seuil P85 du cycle-time historique.</div></div>`;
  }
  return top
    .map((iss, idx) => {
      const cls = iss.riskLevel === "critical" ? "crit" : "warn";
      const num = String(idx + 1).padStart(2, "0");
      const seuil = iss.riskLevel === "critical"
        ? `&gt; P95 (${agingWip.percentiles.p95.toFixed(1)}j)`
        : `&gt; P85 (${agingWip.percentiles.p85.toFixed(1)}j)`;
      return `<div class="action ${cls}"><div class="action-num">// ${num}</div><div class="action-title">Débloquer ${issueLink(iss.issueKey, jiraBaseUrl)}</div><div class="action-detail">${escapeHtml(iss.status)} · âge <strong>${iss.ageDays.toFixed(1)}j</strong> ${seuil} · ${escapeHtml(iss.riskLevel)}</div></div>`;
    })
    .join("");
}

export function isScopeChangeAvailable(db: Database.Database): boolean {
  const cols = db.prepare("PRAGMA table_info(issue_field_changes)").all() as { name: string }[];
  return cols.length > 0;
}

export function buildScopeAlertBanner(db: Database.Database, scopeData: ScopeChangeResult): string {
  if (scopeData.changedIssues === 0) {return "";}

  const activeSprint = db.prepare(
    "SELECT name FROM sprints WHERE state = 'active' ORDER BY start_date DESC LIMIT 1",
  ).get() as { name: string } | undefined;

  if (!activeSprint) {return "";}

  const alertSprints = (scopeData.bySprint[activeSprint.name]?.changedIssues ?? 0) > 0
    ? [activeSprint.name]
    : [];

  if (alertSprints.length === 0) {return "";}

  const count = alertSprints.reduce((s, n) => s + (scopeData.bySprint[n]?.changedIssues ?? 0), 0);
  const sprintLabel = alertSprints.join(", ");
  return `<div class="alert-orange">⚠️ Dérive de périmètre détectée — <strong>${count} issue(s)</strong> modifiée(s) après entrée en sprint <span class="alert-detail">(sprint : ${escapeHtml(sprintLabel)})</span></div>`;
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
        { label: "Issues modifiées", data: extracted.map((e) => e.changed), backgroundColor: "rgba(224, 49, 49, 0.75)", stack: "scope" },
        {
          label: "Taux dérive (%)", data: extracted.map((e) => e.ratio), type: "line", yAxisID: "y2",
          borderColor: "#0bc5ea", backgroundColor: "rgba(11, 197, 234, 0.08)",
          borderWidth: 2, borderDash: [5, 3], pointRadius: 5, pointBackgroundColor: "#0bc5ea",
          tension: 0.3, fill: false,
        },
      ],
    },
    options: {
      datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7 } },
      scales: {
        x: { ticks: { maxRotation: 0, minRotation: 0 } },
        y:  { stacked: true, min: 0, ticks: { stepSize: 1 }, title: { display: true, text: "Nb issues" } },
        y2: { position: "right", min: 0, suggestedMax: 110, title: { display: true, text: "Taux dérive (%)" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

export function buildScopeSection(scopeData: ScopeChangeResult, db: Database.Database, jiraBaseUrl: string): string {
  const chartCfg = buildScopeChangeChart(scopeData);

  let tableHtml = "";
  if (scopeData.changedIssueKeys.length > 0) {
    const keys = scopeData.changedIssueKeys;
    const ph = placeholders(keys);
    const summaries = db.prepare(
      `SELECT key, summary FROM issues WHERE key IN (${ph})`,
    ).all(...keys) as { key: string; summary: string }[];
    const summaryByKey = new Map(summaries.map((r) => [r.key, r.summary]));

    const sprintNames = Object.keys(scopeData.bySprint);
    const sprintStartRows = sprintNames.length > 0
      ? db.prepare(`SELECT name, start_date FROM sprints WHERE name IN (${placeholders(sprintNames)})`).all(...sprintNames) as { name: string; start_date: string | null }[]
      : [];
    const sprintStartByName = new Map(sprintStartRows.map((r) => [r.name, r.start_date ?? ""]));

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
      <thead><tr><th data-col="0">Clé</th><th data-col="1" class="sort-desc">Sprint</th><th data-col="2">Résumé</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const hasData = Object.keys(scopeData.bySprint).length > 0;

  return `<section class="scope-section">
  <div class="actions-head"><h2>Dérive de périmètre par sprint</h2><div class="sep"></div></div>
  <p class="scope-help">Issues dont la description ou le résumé a changé significativement après le début du sprint. Seuil de détection : similarité texte &lt; 85% (Levenshtein normalisé). Une dérive élevée corrèle avec des sprints ratés et un cycle time long.</p>
  ${hasData ? "" : `<p class="text-dim">Aucune dérive de périmètre détectée.</p>`}
  ${hasData ? `<div class="chart-card"><canvas id="scopeChangeChart"></canvas></div>` : ""}
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

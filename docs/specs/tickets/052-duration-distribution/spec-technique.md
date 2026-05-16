# Spec technique — Distribution PDF + CDF lead-time / cycle-time

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/durationDistribution.ts` | **Nouveau** — implémente `Metric<DurationDistributionResult>` (PDF + KDE + CDF, global + par bucket, pour cycle-time et lead-time) |
| `src/metrics/index.ts` | Importe `durationDistributionMetric` et le pousse dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Ajoute `duration-distribution` à la liste skip (comme `forecast`) — pas de backfill |
| `src/report/generate.ts` | Calcule la métrique live (à côté de `forecast`, `agingWip`, `bottleneck`) et l'injecte dans `RenderInput` ; étend l'interface `RenderInput` ; passe la donnée à `renderWithHandlebars` |
| `src/report/chartDefs.ts` | Ajoute 2 entrées `CHART_DEFS` (tab `advanced`, type custom, rendererId `durationDistribution`) |
| `src/report/templates/report.hbs` | Nouveau renderer `renderDurationDistribution()` ; nouvelles sections HTML (canvas + selector) ; nouvelle aide `HELP_BODIES.cycleDistribution` / `leadDistribution` |
| `src/i18n/locales/fr.ts` + `en.ts` | Clés `report.chart.cycleDistribution`, `report.chart.leadDistribution`, `report.help.cycleDistribution.{title,body}`, idem `leadDistribution` |
| `src/metrics/durationDistribution.test.ts` | **Nouveau** — tests TDD (PDF, KDE, CDF, buckets, edge cases) |

---

## 1. Métrique `durationDistribution.ts`

Pattern : `Metric<T>` standard, `compute(ctx: MetricsContext)`. Pas d'accès direct DB. Réutilise `ctx.cycleTimePopulation` (population cycle-time déjà filtrée par `excludeIssueTypes` et `cutoffDate`).

Pour lead-time : itérer la même population et appliquer le **filtre TODO** (cf. `leadTime.ts:22-26`) — la population lead-time est sous-ensemble stricte de la population cycle-time + une transition vers `todoStatuses`.

```ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { bucketize, BUCKET_ORDER, type SizeBucket } from "./utils";

export interface DistributionBin {
  start: number;
  end: number;
  count: number;
}

export interface DistributionPoint {
  x: number;     // jours ouvrés
  density: number; // KDE(x), 0 si masquée
  cdf: number;   // ∈ [0,1]
}

export interface DistributionSeries {
  count: number;        // n
  bins: DistributionBin[];  // PDF discrète
  kde: DistributionPoint[]; // 50 points ; density=0 si n<4 ou σ=0
  hasKde: boolean;          // false si n<4, σ=0, max=0
  max: number;              // borne sup axe X
}

export interface DurationDistributionResult {
  cycle: {
    global: DistributionSeries;
    byBucket: Partial<Record<SizeBucket, DistributionSeries>>;
  };
  lead: {
    global: DistributionSeries;
    byBucket: Partial<Record<SizeBucket, DistributionSeries>>;
  };
}

export const durationDistributionMetric: Metric<DurationDistributionResult> = {
  name: "duration-distribution",
  description: "Distribution PDF + CDF cycle-time et lead-time, global et par bucket",

  compute(ctx: MetricsContext): DurationDistributionResult {
    // ... voir détail ci-dessous
  },
};
```

**Algorithme** :

1. `cycleDays: Map<issueKey, days>` à partir de `ctx.cycleTimePopulation.filter(s => s.doneAt >= s.startedAt)` et `ctx.workingDaysBetween(s.startedAt, s.doneAt)`. **Pas d'exclusion d'outliers** ici — la distribution doit montrer la queue (contrairement aux stats agrégées qui passent par `statsFromDays(values, true)`).
2. `leadDays: Map<issueKey, days>` : pour chaque issue de la population cycle-time, chercher la 1ère transition vers `todoStatuses` (cf. `leadTime.ts:22-26`) ; ignorer si absent ou `doneAt < todoAt`.
3. Bucket de chaque issue via `bucketize({...}, isBug, ctx.config.estimation)` (cf. `cycleTimeBySize.ts:29-33`). `XS|S|M|L|XL` exposés ; `BUG` et `UNESTIMATED` agrégés dans `global` mais non exposés en `byBucket` (ne pas créer d'entrée pour ces clés).
4. Pour chaque série (cycle global, cycle/XS, …, lead global, …) calculer `buildSeries(values)` :

```ts
function buildSeries(values: number[]): DistributionSeries {
  if (values.length === 0) {
    return { count: 0, bins: [], kde: [], hasKde: false, max: 0 };
  }
  const max = Math.max(...values);
  const bins = buildBins(values, max);     // même formule que report/generate.ts:664
  const sigma = stddev(values);
  const hasKde = values.length >= 4 && sigma > 0 && max > 0;
  const kde = buildKdeAndCdf(values, max, hasKde ? bandwidth(sigma, values.length) : null);
  return { count: values.length, bins, kde, hasKde, max };
}
```

5. **buildBins** : même formule que `buildHistogram` actuelle (`generate.ts:664-681`) — **extraire dans `utils.ts` comme `buildHistogramBins(values, max)`** et réutiliser depuis `generate.ts` aussi. Évite duplication.
6. **bandwidth(σ, n)** : `1.06 * σ * Math.pow(n, -1/5)` (Silverman).
7. **buildKdeAndCdf(values, max, h)** : 50 points `x_i = i * max / 49`, `i ∈ [0,49]`. Pour chaque `x_i` :
   - `density(x_i) = h === null ? 0 : (1/(n*h)) * Σ φ((x_i - v_j)/h)` avec `φ(u) = exp(-u²/2)/√(2π)`.
   - `cdf(x_i) = (count of v_j ≤ x_i) / n` (empirique). Pour `i = 0` la valeur est `count(v_j ≤ 0) / n` (≥ 0 toujours).

---

## 2. Registre — `src/metrics/index.ts`

Insérer (ordre groupe « advanced ») :

```ts
import { durationDistributionMetric } from "./durationDistribution";
// ...
const ALL_METRICS = [
  // ... existants
  bottleneckAnalysisMetric,
  durationDistributionMetric,
];
```

---

## 3. Skip snapshot — `src/snapshots/compute.ts`

Repérer le `switch` ou la liste de skip pour `forecast` :

```bash
grep -n "forecast" src/snapshots/compute.ts
```

Ajouter `duration-distribution` au même endroit. Justifier en commentaire : *shape non-tabulaire ; recalcul live trivial ; non-déterministe sur petites populations à cause de KDE-bandwidth qui dépend de σ instable*.

---

## 4. Injection dans le report — `src/report/generate.ts`

Autour de la ligne 478 (où `liveCtx` est déjà construit) :

```ts
const liveCtx = buildMetricsContext(store, config);
const agingWip = agingWipMetric.compute(liveCtx);
const forecast = forecastMetric.compute(liveCtx);
const bottleneck = bottleneckAnalysisMetric.compute(liveCtx);
const distribution = durationDistributionMetric.compute(liveCtx); // ← NEW
const cycleTime = cycleTimeMetric.compute(liveCtx);
// ...
```

Étendre `RenderInput` (interface ligne ~625) :

```ts
import type { DurationDistributionResult } from "../metrics/durationDistribution";
// ...
interface RenderInput {
  // ... existants
  bottleneck: BottleneckAnalysisResult;
  distribution: DurationDistributionResult; // ← NEW
}
```

Injecter dans `renderInput` (ligne 493) :

```ts
const renderInput: RenderInput = {
  // ...
  bottleneck,
  distribution,
  sprintCharts,
  rolesSprintCharts,
};
```

---

## 5. Chart defs — `src/report/chartDefs.ts`

À la fin du bloc `// ── Advanced ──`, ajouter :

```ts
{
  id: "cycleDistributionChart", key: "cycleDistribution", tab: "advanced",
  titleKey: "report.chart.cycleDistribution", helpKey: "cycleDistribution",
  data: null,
  chart: { type: "custom", rendererId: "durationDistribution" },
},
{
  id: "leadDistributionChart", key: "leadDistribution", tab: "advanced",
  titleKey: "report.chart.leadDistribution", helpKey: "leadDistribution",
  data: null,
  chart: { type: "custom", rendererId: "durationDistribution" },
},
```

Le même `rendererId` sert pour les deux ; la donnée à afficher (cycle ou lead) est déterminée par l'`id` du canvas dans le renderer (cf. ci-dessous).

---

## 6. Renderer + HTML — `src/report/templates/report.hbs`

### Données injectées

Dans la zone d'init data (autour de `report.hbs:382` où `LEAD_BY_SIZE` est déclaré) :

```js
const DISTRIBUTION = _D.distribution;  // { cycle: {global, byBucket}, lead: {global, byBucket} }
```

### HTML

Dans la section onglet `advanced` (autour de `generate.ts:925-933` où `leadBySize`/`cycleBySize` adv sont rendus), ajouter :

```html
<section>
  <h3>${escapeHtml(t("report.chart.cycleDistribution"))}${helpBtn("cycleDistribution")}</h3>
  <div class="bucket-selector" id="cycleDistributionBuckets"></div>
  <div class="chart-wrap"><canvas id="cycleDistributionChart"></canvas></div>
</section>
<section>
  <h3>${escapeHtml(t("report.chart.leadDistribution"))}${helpBtn("leadDistribution")}</h3>
  <div class="bucket-selector" id="leadDistributionBuckets"></div>
  <div class="chart-wrap"><canvas id="leadDistributionChart"></canvas></div>
</section>
```

### Renderer JS

Nouveau bloc IIFE à la fin des renderers existants (après `renderHistogram`, avant `renderAging`) :

```js
(function renderDurationDistribution() {
  function initDistributionChart(canvasId, selectorId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const buckets = ["Global", ...Object.keys(data.byBucket)]; // ordre XS/S/M/L/XL natif du Map
    const selector = document.getElementById(selectorId);
    selector.innerHTML = buckets.map(function(b) {
      return '<button class="bucket-btn' + (b === "Global" ? " active" : "") + '" data-bucket="' + b + '">' + b + '</button>';
    }).join("");
    let chart = null;
    function getSeries(bucket) {
      return bucket === "Global" ? data.global : data.byBucket[bucket];
    }
    function build(bucket) {
      const s = getSeries(bucket);
      if (!s || s.count === 0) {
        ctx.style.display = "none";
        // afficher message vide
        return;
      }
      ctx.style.display = "";
      // Datasets : bars PDF (Y gauche), line KDE (Y gauche), line CDF (Y droite, en %)
      const pdfLabels = s.bins.map(function(b){ return b.end.toFixed(1); });
      const pdfData = s.bins.map(function(b){ return b.count; });
      const kdeData = s.hasKde ? s.kde.map(function(p){ return { x: p.x, y: p.density }; }) : [];
      const cdfData = s.kde.map(function(p){ return { x: p.x, y: p.cdf * 100 }; });
      if (chart) chart.destroy();
      chart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: pdfLabels,
          datasets: [
            { type: "bar", label: "Issues", data: pdfData, yAxisID: "yL", backgroundColor: "#2563eb88" },
            { type: "line", label: "KDE", data: kdeData, yAxisID: "yL", parsing: false, borderColor: "#10b981", pointRadius: 0, tension: 0.3 },
            { type: "line", label: "CDF", data: cdfData, yAxisID: "yR", parsing: false, borderColor: "#f59e0b", pointRadius: 0, tension: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: "Durée (j ouvrés)" } },
            yL: { position: "left", beginAtZero: true, title: { display: true, text: "Issues / densité" } },
            yR: { position: "right", min: 0, max: 100, ticks: { stepSize: 25, callback: function(v){ return v + " %"; } }, title: { display: true, text: "P(durée ≤ x)" }, grid: { drawOnChartArea: false } },
          },
        },
      });
    }
    selector.addEventListener("click", function(ev) {
      const btn = ev.target.closest(".bucket-btn");
      if (!btn) return;
      selector.querySelectorAll(".bucket-btn").forEach(function(b){ b.classList.remove("active"); });
      btn.classList.add("active");
      build(btn.dataset.bucket);
    });
    build("Global");
  }
  if (DISTRIBUTION) {
    initDistributionChart("cycleDistributionChart", "cycleDistributionBuckets", DISTRIBUTION.cycle);
    initDistributionChart("leadDistributionChart",  "leadDistributionBuckets",  DISTRIBUTION.lead);
  }
})();
```

### Help

Ajouter à `HELP_BODIES` (cf. `generate.ts:962`) :

- `cycleDistribution` : *« Distribution complète du cycle-time. Bars : histogramme empirique. KDE (vert) : densité lissée — révèle la forme (uni/bimodal, queue lourde). CDF (orange, axe droit) : P(cycle ≤ x). Sélecteur : restreindre à un bucket de taille. »*
- `leadDistribution` : idem en remplaçant « cycle-time » par « lead-time ».

---

## 7. i18n — `src/i18n/locales/fr.ts` + `en.ts`

Ajouter sous `report.chart` :

```ts
cycleDistribution: "Distribution cycle-time",
leadDistribution:  "Distribution lead-time",
```

Et sous `report.help` :

```ts
cycleDistribution: { title: "Distribution cycle-time", body: "..." },
leadDistribution:  { title: "Distribution lead-time",  body: "..." },
```

Vérifier les clés equivalentes côté `en.ts`.

---

## 8. Refactor `buildHistogramBins` partagé

Extraire la fonction `buildHistogram(values: number[])` de `report/generate.ts:664-681` vers `src/metrics/utils.ts` sous le nom `buildHistogramBins(values, max)` (signature avec `max` pré-calculé pour éviter le double scan). Réutilisée dans `cycleHistogram` legacy (formule mixte `0.5 / 1 / ⌈max/20⌉`).

```ts
// utils.ts
export interface HistogramBin { start: number; end: number; count: number; }

export function buildHistogramBins(values: number[], max: number): HistogramBin[] {
  if (values.length === 0 || max <= 0) {return [];}
  const binWidth = max <= 5 ? 0.5 : max <= 20 ? 1 : Math.ceil(max / 20);
  const binCount = Math.ceil((max + 0.0001) / binWidth);
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({ start: i * binWidth, end: (i + 1) * binWidth, count: 0 });
  }
  for (const v of values) {
    const idx = Math.min(bins.length - 1, Math.floor(v / binWidth));
    bins[idx].count++;
  }
  return bins;
}
```

`durationDistribution.ts` n'utilise PAS ce helper. Bins fixes 1 jour-ouvré (`buildUnitBins` local) pour aligner l'axe x sur l'unité de mesure des durées ; la courbe KDE porte le lissage visuel, des bins agrégés masqueraient les pics journaliers du PDF.

---

## Ordre d'implémentation (TDD)

1. **Test** : `durationDistribution.test.ts` — scénarios `(count=0) → empty`, `(count=1) → 1 bin, hasKde=false`, `(count=10, σ>0) → hasKde=true, kde.length=50, cdf monotone croissante de cdf[0]≥0 à cdf[49]=1`, `bucket filtering exclut BUG/UNESTIMATED de byBucket`, `lead-time exclut issues sans transition TODO`.
2. **Refactor** : extraire `buildHistogramBins` dans `utils.ts` + remplacer usage dans `generate.ts`. Tests existants verts.
3. **Implémente** `durationDistributionMetric` jusqu'à tests verts.
4. **Registre** : ajouter dans `ALL_METRICS`, vérifier `npm run metrics -- -m duration-distribution --json` produit un output cohérent.
5. **Skip snapshot** : ajout dans `snapshots/compute.ts`. Vérifier `npm run snapshots` ne crash pas et n'écrit pas de ligne pour `duration-distribution`.
6. **Report** : injection dans `RenderInput`, chart defs, HTML, renderer, i18n. Lancer `npm run report -- -c config.fake.yaml -b board.fake.yaml -o /tmp/r.html` et ouvrir dans navigateur, tester sélecteurs.
7. **Lint** : `npx eslint src/metrics/durationDistribution.ts src/report/generate.ts src/report/chartDefs.ts`.
8. **/simplify** + code review sous-agent indépendant.
9. **Mise à jour `description.md`** : `Statut: livré`. **Pas de modification de `docs/specs/system/*`** sauf si l'ajout change un invariant — ici aucun (métrique additive, pas snapshottée, pas d'impact schéma).

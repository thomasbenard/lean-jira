# Spec technique — Séries temporelles lead/cycle time par bucket

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/snapshots/compute.ts` | Ajouter P95 dans extractStats branche "buckets" |
| `src/report/generate.ts` | Nouvelle structure de données + HTML + JS |

---

## 1. Snapshots — ajout P95

Dans `extractStats` (`compute.ts`), branche `"buckets" in result` :

```ts
out.push({ snapshot_date: date, metric_name: metricName, bucket: b, stat: "p95", value: s.p95Days });
```

`DurationStats` expose déjà `p95Days` (vérifier dans `utils.ts`).

Relancer `npm run snapshots` après le changement pour peupler les nouvelles lignes.

---

## 2. generate.ts — structure de données

### Type

```ts
interface BucketTimeSeries {
  dates: string[];
  series: Record<string, number[]>; // clé = stat: "median" | "p85" | "p95"
}
```

### Fonction de construction

```ts
function buildBucketSeries(
  snapshots: SnapshotRow[],
  metric: string,
  bucket: string,
  stats: string[],
): BucketTimeSeries { ... }
```

Identique à `buildSeries` existante, filtre `s.bucket === bucket`.

### Objet passé au template

```ts
const leadTimeBySizeCharts: Record<string, BucketTimeSeries> = {};
const cycleTimeBySizeCharts: Record<string, BucketTimeSeries> = {};

for (const b of BUCKET_ORDER) {
  const lead = buildBucketSeries(snapshots, "lead-time-by-size", b, ["median", "p85", "p95"]);
  if (lead.dates.length > 0) leadTimeBySizeCharts[b] = lead;
  // idem cycle
}
```

Seuls les buckets avec données sont inclus → frontend n'affiche que les boutons pertinents.

Ajouter `leadTimeBySizeCharts` et `cycleTimeBySizeCharts` dans `RenderInput` et `renderHtml`.

---

## 3. HTML — structure

Dans la section "Par taille", après les tableaux existants :

```html
<div class="by-size-trends">
  <div class="chart-card">
    <h3>Lead time par taille (jours) <helpBtn></h3>
    <div class="bucket-selector" id="leadBySizeBuckets"><!-- boutons injectés par JS --></div>
    <canvas id="leadBySizeChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Cycle time par taille (jours) <helpBtn></h3>
    <div class="bucket-selector" id="cycleBySizeBuckets"><!-- boutons injectés par JS --></div>
    <canvas id="cycleBySizeChart"></canvas>
  </div>
</div>
```

### CSS

```css
.by-size-trends { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem; }
.bucket-selector { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
.bucket-btn {
  padding: 0.25rem 0.6rem; border-radius: 4px; border: 1px solid #d1d5db;
  background: #f9fafb; cursor: pointer; font-size: 0.8rem; color: #374151;
}
.bucket-btn.active { background: #2563eb; color: white; border-color: #2563eb; }
```

---

## 4. JavaScript

Données injectées côté serveur :

```js
const LEAD_BY_SIZE = ${JSON.stringify(leadTimeBySizeCharts)};
const CYCLE_BY_SIZE = ${JSON.stringify(cycleTimeBySizeCharts)};
const BUCKET_LABELS = ${JSON.stringify(BUCKET_LABELS)};
```

Fonction générique :

```js
function initBucketSelector(dataByBucket, canvasId, selectorId) {
  const buckets = Object.keys(dataByBucket);
  if (buckets.length === 0) return;

  // Bucket par défaut = celui avec le plus de points de données
  let activeBucket = buckets.reduce((a, b) =>
    (dataByBucket[a].dates.length >= dataByBucket[b].dates.length ? a : b)
  );

  const selectorEl = document.getElementById(selectorId);
  const ctx = document.getElementById(canvasId);
  let chart = null;

  function renderButtons() {
    selectorEl.innerHTML = buckets.map(b =>
      `<button class="bucket-btn${b === activeBucket ? ' active' : ''}" data-bucket="${b}">
        ${BUCKET_LABELS[b] ?? b}
      </button>`
    ).join('');
    selectorEl.querySelectorAll('.bucket-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeBucket = btn.dataset.bucket;
        renderButtons();
        renderChart();
      });
    });
  }

  function renderChart() {
    const data = dataByBucket[activeBucket];
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.dates,
        datasets: [
          { label: 'P50', data: data.series.median, borderColor: COLOR_MEDIAN, backgroundColor: COLOR_MEDIAN + '22', tension: 0.2, pointRadius: 2 },
          { label: 'P85', data: data.series.p85,    borderColor: COLOR_P85,    backgroundColor: COLOR_P85    + '22', tension: 0.2, pointRadius: 2 },
          { label: 'P95', data: data.series.p95,    borderColor: '#ef4444',    backgroundColor: '#ef444422',  tension: 0.2, pointRadius: 2 },
        ],
      },
      options: baseOpts,
    });
  }

  renderButtons();
  renderChart();
}

initBucketSelector(LEAD_BY_SIZE,  'leadBySizeChart',  'leadBySizeBuckets');
initBucketSelector(CYCLE_BY_SIZE, 'cycleBySizeChart', 'cycleBySizeBuckets');
```

---

## Ordre d'implémentation

1. Vérifier que `DurationStats.p95Days` existe dans `utils.ts`
2. Ajouter P95 dans `extractStats` + relancer `npm run snapshots`
3. Ajouter `buildBucketSeries` + `leadTimeBySizeCharts` / `cycleTimeBySizeCharts` dans `generate.ts`
4. Ajouter HTML + CSS + JS dans `renderHtml`
5. Vérifier rendu dans navigateur sur tous les buckets disponibles

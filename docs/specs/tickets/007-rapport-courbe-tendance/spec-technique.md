# Spec technique — Courbe de tendance sur les graphes du rapport

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Ajout de `computeMovingAvg()` + modification de `lineChart()` + mise à jour de `renderChart()` dans `initBucketSelector` — tous dans le bloc `<script>` de la template string |

---

## 1. `src/report/generate.ts` — bloc `<script>` (≈ lignes 453–684)

### 1.1 Nouvelle fonction `computeMovingAvg`

À injecter **avant** `lineChart` dans le bloc `<script>` :

```js
function computeMovingAvg(values, window = 4) {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return Math.round(slice.reduce((a, b) => a + b, 0) / window * 100) / 100;
  });
}
```

### 1.2 Modification de `lineChart`

Signature actuelle (ligne 468) :
```js
function lineChart(canvasId, series, datasets) {
```

Nouvelle signature :
```js
function lineChart(canvasId, series, datasets, withTrend = false) {
```

Dans le corps, après la construction du tableau `datasets.map(...)`, si `withTrend` est true et que la série du premier dataset a au moins un point :

```js
const builtDatasets = datasets.map(d => ({
  label: d.label, data: series.series[d.key], borderColor: d.color,
  backgroundColor: d.color + "22", tension: 0.2, pointRadius: 2,
}));

if (withTrend) {
  const primaryKey = datasets[0].key;
  const trendData = computeMovingAvg(series.series[primaryKey] ?? []);
  if (trendData.some(v => v !== null)) {
    builtDatasets.push({
      label: "Tendance",
      data: trendData,
      borderColor: "#64748b88",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [6, 4],
      tension: 0,
      pointRadius: 0,
      fill: false,
    });
  }
}

new Chart(ctx, {
  type: "line",
  data: { labels: series.dates, datasets: builtDatasets },
  options: baseOpts,
});
```

### 1.3 Mise à jour des appels `lineChart`

Tous les appels existants (`lineChart("leadTimeChart", ...)` etc.) reçoivent `true` en 4e argument :

```js
lineChart("leadTimeChart",           CHARTS.leadTime,           [...], true);
lineChart("cycleTimeChart",          CHARTS.cycleTime,          [...], true);
lineChart("throughputChart",         CHARTS.throughput,         [...], true);
lineChart("throughputWeightedChart", CHARTS.throughputWeighted, [...], true);
lineChart("wipChart",                CHARTS.wip,                [...], true);
lineChart("bugThroughputChart",      CHARTS.bugThroughput,      [...], true);
lineChart("bugCycleTimeChart",       CHARTS.bugCycleTime,       [...], true);
lineChart("cycleNormalizedChart",    CHARTS.cycleTimeNormalized,[...], true);
lineChart("flowEfficiencyChart",     CHARTS.flowEfficiency,     [...], true);
```

### 1.4 Mise à jour de `renderChart` dans `initBucketSelector` (lignes 662–677)

Dans la fonction interne `renderChart()`, après construction du tableau `datasets`, ajouter la tendance sur `median` :

```js
function renderChart() {
  const data = dataByBucket[activeBucket];
  if (chart) chart.destroy();

  const trendData = computeMovingAvg(data.series.median ?? []);
  const trendDataset = trendData.some(v => v !== null) ? [{
    label: "Tendance",
    data: trendData,
    borderColor: "#64748b88",
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderDash: [6, 4],
    tension: 0,
    pointRadius: 0,
    fill: false,
  }] : [];

  chart = new Chart(canvasEl, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: [
        { label: 'P50', data: data.series.median, borderColor: COLOR_MEDIAN, backgroundColor: COLOR_MEDIAN + '22', tension: 0.2, pointRadius: 2 },
        { label: 'P85', data: data.series.p85,    borderColor: COLOR_P85,    backgroundColor: COLOR_P85    + '22', tension: 0.2, pointRadius: 2 },
        { label: 'P95', data: data.series.p95,    borderColor: COLOR_P95,    backgroundColor: COLOR_P95    + '22', tension: 0.2, pointRadius: 2 },
        ...trendDataset,
      ],
    },
    options: baseOpts,
  });
}
```

---

## Ordre d'implémentation

1. Écrire le test (TDD) : `computeMovingAvg` est une pure fonction exportable — extraire dans une constante testable ou tester via snapshot HTML
2. Ajouter `computeMovingAvg()` dans le bloc `<script>` de `renderHtml()`
3. Modifier `lineChart()` pour accepter `withTrend` et injecter le dataset tendance
4. Passer `true` sur tous les appels `lineChart`
5. Mettre à jour `renderChart()` dans `initBucketSelector`
6. Vérifier visuellement (`npm run report` + ouvrir le HTML)

---

## Notes

- `borderDash` est une propriété Chart.js valide pour les datasets line (pas besoin de plugin).
- La tendance sur `median` pour les by-size charts est cohérente : c'est la série centrale, celle que le lecteur suit en premier.
- Chart.js 4 skip les `null` par défaut (`spanGaps: false` est le défaut) — les 3 premiers points de la moyenne mobile n'apparaissent pas sur le graphe, ce qui est le comportement souhaité.
- Ne pas ajouter `spanGaps: true` sur le dataset tendance (ça relierait les nulls aux premiers vrais points, créant une droite trompeuse depuis l'origine).

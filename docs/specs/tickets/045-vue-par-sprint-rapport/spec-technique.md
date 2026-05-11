# Spec technique — Vue par sprint dans le rapport

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Requête sprints DB, compute débit par sprint, extension `RenderInput.sprintCharts` |
| `src/report/templates/report.hbs` | Toggle bouton + JS dataset swap pour les 3 graphes débit |
| `tests/report/generate.test.ts` | Scénarios sprint view |

---

## 1. `src/report/generate.ts` — Compute sprint series

### Nouveau type

```typescript
export interface SprintChartSeries {
  labels: string[];        // noms des sprints (axe X)
  series: Record<string, number[]>;
  hasActiveSprint: boolean; // true si le dernier sprint est state='active'
}
```

### Requête sprints

Dans `generateReport()`, après la ligne 199 (`snapshots = db.prepare(...).all()`), ajouter :

```typescript
const sprintRows = db.prepare(`
  SELECT id, name, state, start_date, end_date
  FROM sprints
  WHERE start_date IS NOT NULL
  ORDER BY start_date ASC
`).all() as { id: number; name: string; state: string; start_date: string; end_date: string | null }[];
```

### Compute par sprint

```typescript
function buildSprintSeries(
  db: Database.Database,
  config: MetricConfig,
  sprints: { name: string; state: string; start_date: string; end_date: string | null }[],
): {
  throughput: SprintChartSeries;
  bugThroughput: SprintChartSeries;
  throughputWeighted: SprintChartSeries;
} {
  // Pour chaque sprint, appeler metric.compute() avec window [start_date, end_date]
  // end_date null (sprint actif) → windowEndDate = today ISO
}
```

Pattern identique à `snapshots/compute.ts:96-99` :
```typescript
const cfg: MetricConfig = {
  ...config,
  cutoffDate: sprint.start_date,
  windowEndDate: sprint.end_date ?? new Date().toISOString().slice(0, 10),
};
const result = throughputMetric.compute(db, cfg);
```

Pour `throughput` et `bug-throughput` : agréger `result.byWeek.reduce((s, w) => s + w.count, 0)`.
Pour `throughput-weighted` : agréger `estimatedDays` depuis `byWeek`.

Label sprint actif : `sprint.name + " (en cours)"`.

### Extension RenderInput

Ajouter dans l'interface `RenderInput` (ligne ~409) :

```typescript
sprintCharts: {
  throughput: SprintChartSeries;
  bugThroughput: SprintChartSeries;
  throughputWeighted: SprintChartSeries;
} | null; // null si aucun sprint disponible
```

`null` si `sprintRows.length === 0`.

---

## 2. `src/report/templates/report.hbs` — Toggle UI + JS

### Toggle HTML

Au-dessus des graphes throughput (repérer la section par son id existant dans le template) :

```html
{{#if sprintCharts}}
<div class="chart-toggle" id="debit-toggle">
  <button class="toggle-btn active" data-view="week">Semaines</button>
  <button class="toggle-btn" data-view="sprint">Sprints</button>
</div>
{{/if}}
```

### Données sprint injectées

Dans le bloc `<script>` du template, en JSON :

```js
const SPRINT_CHARTS = {{#if sprintCharts}}{
  throughput: {{{json sprintCharts.throughput}}},
  bugThroughput: {{{json sprintCharts.bugThroughput}}},
  throughputWeighted: {{{json sprintCharts.throughputWeighted}}}
}{{else}}null{{/if}};
```

`{{{json ...}}}` = helper Handlebars existant dans `generate.ts` (`jsonHelper`) ou à ajouter (pattern : `JSON.stringify(value)`).

### JS toggle

```js
document.getElementById('debit-toggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn || !SPRINT_CHARTS) return;
  const view = btn.dataset.view;
  document.querySelectorAll('#debit-toggle .toggle-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  switchDebitView(view);
});

function switchDebitView(view) {
  if (view === 'sprint') {
    updateChart(throughputChart, SPRINT_CHARTS.throughput.labels, SPRINT_CHARTS.throughput.series);
    updateChart(bugThroughputChart, SPRINT_CHARTS.bugThroughput.labels, SPRINT_CHARTS.bugThroughput.series);
    updateChart(throughputWeightedChart, SPRINT_CHARTS.throughputWeighted.labels, SPRINT_CHARTS.throughputWeighted.series);
  } else {
    // restaurer les datasets hebdomadaires depuis WEEKLY_CHARTS (déjà en mémoire ou re-injectés)
  }
}
```

Sprint actif : dans `updateChart`, si `SprintChartSeries.hasActiveSprint === true`, le dernier dataset point reçoit `backgroundColor: 'rgba(X,X,X,0.4)'` (translucide).

---

## Ordre d'implémentation

1. **Tests rouges** : `tests/report/generate.test.ts` — scénarios `buildSprintSeries` (happy path, sprint actif, aucun sprint)
2. Ajouter `SprintChartSeries` + `buildSprintSeries()` dans `generate.ts`
3. Étendre `RenderInput` + alimenter `sprintCharts` dans `generateReport()`
4. Template `report.hbs` : toggle HTML + injection JSON `SPRINT_CHARTS`
5. Template `report.hbs` : JS toggle + `switchDebitView()`
6. Tests verts

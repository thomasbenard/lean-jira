# Spec technique — Dev time allocation (features vs bugs)

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/devTimeAllocation.ts` | Nouveau fichier — metric `dev-time-allocation` |
| `src/metrics/index.ts` | Enregistrement dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Ajout à `WEEKLY_METRICS` + nouveau branch `extractStats` |
| `src/report/generate.ts` | HELP_TEXTS, `buildSeries`, HTML chart card, JS `lineChart` call |

---

## 1. `src/metrics/devTimeAllocation.ts` (nouveau)

Shape de sortie :

```ts
export interface DevTimeAllocationByWeek {
  week: string;       // "%Y-W%W" sur done_at
  featureDays: number;
  bugDays: number;
  bugRatio: number;   // bugDays / (featureDays + bugDays), 0 si total = 0
}

export interface DevTimeAllocationSummary {
  byWeek: DevTimeAllocationByWeek[];
  avgBugRatio: number; // moyenne des bugRatio sur les semaines avec livraisons
}
```

SQL : calqué sur `cycleTime.ts` (lignes 29-45) mais avec `i.issue_type` et sans agrégation
par semaine en SQL (on agrège en TypeScript pour pouvoir appeler `workingDaysBetween`) :

```ts
const rows = db.prepare(`
  WITH ${delivered.cte}
  SELECT t.issue_key,
         MIN(t.transitioned_at) AS started_at,
         d.done_at,
         i.issue_type
  FROM transitions t
  JOIN issues i ON i.key = t.issue_key
  JOIN delivered d ON d.issue_key = t.issue_key
  WHERE t.to_status IN (${devStartPh})
    ${cutoffSql} ${endSql}
    AND EXISTS (SELECT 1 FROM transitions t2
                WHERE t2.issue_key = t.issue_key
                  AND t2.to_status IN (${todoPh}))
  GROUP BY t.issue_key, d.done_at, i.issue_type
`).all(...delivered.args, ...config.devStartStatuses,
       ...cutoffArgs, ...endArgs, ...config.todoStatuses)
  as Array<{ issue_key: string; started_at: string; done_at: string; issue_type: string }>;
```

Agrégation TypeScript :

```ts
const bugTypes = new Set(config.bugIssueTypes);
const byWeekMap = new Map<string, { featureDays: number; bugDays: number }>();

for (const r of rows) {
  if (r.done_at < r.started_at) continue;
  const days = workingDaysBetween(r.started_at, r.done_at);
  const week = isoWeek(r.done_at); // strftime équivalent TS : voir ci-dessous
  const entry = byWeekMap.get(week) ?? { featureDays: 0, bugDays: 0 };
  if (bugTypes.has(r.issue_type)) entry.bugDays += days;
  else entry.featureDays += days;
  byWeekMap.set(week, entry);
}
```

Fonction `isoWeek(dateISO: string): string` : extrait `%Y-W%W` en TypeScript pur
(année + semaine ISO, zéro-paddée) pour éviter une dépendance SQL dans l'agrégation.
Pattern : `new Date(dateISO)` → `getUTCFullYear()` + `getUTCDay()`/`getUTCDate()`.

Résultat trié par semaine ASC. `avgBugRatio` = moyenne des `bugRatio` des semaines où
`featureDays + bugDays > 0`.

---

## 2. `src/metrics/index.ts`

```ts
import { devTimeAllocationMetric } from "./devTimeAllocation";
// ...
export const ALL_METRICS: Metric<unknown>[] = [
  // ... métriques existantes
  devTimeAllocationMetric,
];
```

---

## 3. `src/snapshots/compute.ts`

### 3a. Ajout à WEEKLY_METRICS (ligne 8)

```ts
const WEEKLY_METRICS = new Set([
  "throughput", "throughput-weighted", "bug-throughput",
  "dev-time-allocation",  // fenêtre 7j comme les autres debits
]);
```

### 3b. Nouveau branch dans `extractStats` (après le branch `byWeek` existant, ligne 138)

Le branch `byWeek` existant ne reconnaît pas `featureDays`/`bugDays` — il faut un branch
dédié **avant** le branch générique `byWeek` pour éviter collision :

```ts
} else if ("avgBugRatio" in result) {
  // dev-time-allocation shape
  const r = result as unknown as DevTimeAllocationSummary;
  const totalFeature = r.byWeek.reduce((s, w) => s + w.featureDays, 0);
  const totalBug     = r.byWeek.reduce((s, w) => s + w.bugDays, 0);
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "featureDays", value: totalFeature });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "bugDays",     value: totalBug });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "bugRatio",    value: r.avgBugRatio });
}
```

Import à ajouter : `import { DevTimeAllocationSummary } from "../metrics/devTimeAllocation";`

---

## 4. `src/report/generate.ts`

### 4a. HELP_TEXTS (après `bugCycleTime`, ~ligne 63)

```ts
devTimeAllocation: {
  title: "Allocation dev : features vs bugs",
  body:
    "Somme des cycle times livrés par semaine, split features (US/TS) vs bugs. " +
    "bugRatio = bugDays / totalDays. Hausse du ratio = dérive vers mode pompier.",
},
```

### 4b. buildSeries (~ligne 134)

```ts
devTimeAllocation: buildSeries(metricRows("dev-time-allocation"), "", ["featureDays", "bugDays", "bugRatio"]),
```

### 4c. HTML chart card (~ligne 398, après `bugThroughputChart`)

```html
<div class="chart-card">
  <h3>Allocation dev : features vs bugs${helpBtn("devTimeAllocation")}</h3>
  <canvas id="devTimeAllocationChart"></canvas>
</div>
```

### 4d. JS chart (~ligne 500, après `bugThroughputChart` call)

Chart empilé barres + ligne ratio sur axe secondaire. Utiliser Chart.js `type: "bar"` avec
`stacked: true` pour `featureDays` et `bugDays`, et un dataset `type: "line"` pour `bugRatio`
sur `yAxisID: "y2"`. Pattern existant `lineChart()` ne supporte pas le stacking — implémenter
un helper `stackedBarChart()` dédié ou inliner le config Chart.js directement dans le template
(cohérent avec le pattern inline existant pour le forecast chart).

---

## Ordre d'implémentation

1. **TDD** — écrire les tests de `devTimeAllocation.ts` : agrégation par semaine, split
   bug/feature, cas limites (semaine vide, `bugIssueTypes` vide, cycle time négatif ignoré)
2. Implémenter `src/metrics/devTimeAllocation.ts` jusqu'à tests verts
3. Enregistrer dans `src/metrics/index.ts`
4. Ajouter à `WEEKLY_METRICS` + branch `extractStats` dans `src/snapshots/compute.ts`
5. Ajouter chart dans `src/report/generate.ts` (helper `stackedBarChart` + ligne ratio)
6. Vérifier `npm run metrics -m dev-time-allocation` puis `npm run snapshots && npm run report`

# Spec technique — Rapport : métriques role-aware

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/snapshots/compute.ts` | Resserrer discriminateur `byRole` + 4 nouvelles branches `extractStats` |
| `src/report/generate.ts` | `buildRoleSeries` helper + charts object + RenderInput + HTML + JS + HELP_TEXTS |
| `tests/snapshots/extractStats.test.ts` | Nouveaux cas pour les 4 shapes 022–025 |
| `tests/report/generate.test.ts` | Vérifier présence des canvas ids dans le HTML généré |

---

## 1. `src/snapshots/compute.ts`

### 1a. Resserrer le discriminateur `stage-time-breakdown`

Ligne ~155 actuelle :
```typescript
} else if ("byRole" in result) {
  const r = result as unknown as StageTimeSummary;
```

Changer en :
```typescript
} else if ("avgShareByRole" in result) {
  const r = result as unknown as StageTimeSummary;
```

`avgShareByRole` est unique à `StageTimeSummary` et absent de `WipPerRoleResult`.

### 1b. 4 nouvelles branches après la branche `byWeek` (ligne ~165)

**`WipPerRoleResult`** — discriminateur `"byRole" in result` (désormais libre) :
```typescript
} else if ("byRole" in result && !("avgShareByRole" in result)) {
  // wip-per-role
  const r = result as unknown as { byRole: { dev: { count: number }; qa: { count: number }; po: { count: number } } };
  for (const role of ["dev", "qa", "po"] as const) {
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "count", value: r.byRole[role].count });
  }
```

**`StageThroughputGapResult`** — discriminateur `"avgNetByRole" in result` :
```typescript
} else if ("avgNetByRole" in result) {
  const r = result as unknown as {
    byWeek: { devIn: number; devOut: number; qaIn: number; qaOut: number; poIn: number; poOut: number }[];
    avgNetByRole: { dev: number; qa: number; po: number };
  };
  let sumDevIn = 0, sumDevOut = 0, sumQaIn = 0, sumQaOut = 0, sumPoIn = 0, sumPoOut = 0;
  for (const w of r.byWeek) {
    sumDevIn += w.devIn; sumDevOut += w.devOut;
    sumQaIn  += w.qaIn;  sumQaOut  += w.qaOut;
    sumPoIn  += w.poIn;  sumPoOut  += w.poOut;
  }
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "dev", stat: "in",     value: sumDevIn });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "dev", stat: "out",    value: sumDevOut });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "dev", stat: "avgNet", value: r.avgNetByRole.dev });
  // idem qa, po
```

**`HandoffReworkResult`** — discriminateur `"reworkRatio" in result` :
```typescript
} else if ("reworkRatio" in result) {
  const r = result as unknown as {
    count: number;
    reworkRatio: number;
    avgReworks: number;
    byReworkType: { qaToDev: number; poToQa: number; poDev: number };
  };
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "",        stat: "count",       value: r.count });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "",        stat: "reworkRatio", value: r.reworkRatio });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "",        stat: "avgReworks",  value: r.avgReworks });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "qaToDev", stat: "count",       value: r.byReworkType.qaToDev });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "poToQa",  stat: "count",       value: r.byReworkType.poToQa });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "poDev",   stat: "count",       value: r.byReworkType.poDev });
```

**`FirstTimeRightResult`** — discriminateur `"ftrByRole" in result` :
```typescript
} else if ("ftrByRole" in result) {
  const r = result as unknown as {
    count: number;
    ftrByRole: { dev: { eligible: number; ftrRate: number; avgPasses: number };
                 qa:  { eligible: number; ftrRate: number; avgPasses: number };
                 po:  { eligible: number; ftrRate: number; avgPasses: number } };
  };
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
  for (const role of ["dev", "qa", "po"] as const) {
    const s = r.ftrByRole[role];
    if (s.eligible === 0) { continue; }
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "ftrRate",   value: s.ftrRate });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgPasses", value: s.avgPasses });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "eligible",  value: s.eligible });
  }
```

### Imports à ajouter

```typescript
// Ajouter aux imports existants (après import StageTimeSummary)
import { type WipPerRoleResult } from "../metrics/wipPerRole";
import { type StageThroughputGapResult } from "../metrics/stageThroughputGap";
import { type HandoffReworkResult } from "../metrics/handoffRework";
import { type FirstTimeRightResult } from "../metrics/firstTimeRight";
```

Les casts `as unknown as` suffisent pour les branches — les imports servent uniquement à la vérification de type si le compilateur l'exige. En pratique, les types inlinés dans les branches sont suffisants.

---

## 2. `src/report/generate.ts`

### 2a. Helper `buildRoleSeries`

Ajouter après `buildBucketSeries` (ligne ~260) :

```typescript
// Combine plusieurs buckets en une ChartSeries multi-clés : { dates, series: { dev: [], qa: [], po: [] } }
export function buildRoleSeries(
  snapshots: SnapshotRow[],
  buckets: string[],
  stat: string,
): ChartSeries {
  const dateSet = new Set<string>();
  const byBucket = new Map<string, Map<string, number>>();
  for (const b of buckets) { byBucket.set(b, new Map()); }

  for (const s of snapshots) {
    if (!buckets.includes(s.bucket) || s.stat !== stat) { continue; }
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
```

### 2b. Entrées dans `charts` (après ligne ~191)

```typescript
stageTimeByRole:      buildRoleSeries(metricRows("stage-time-breakdown"),  ["dev","qa","po"], "median"),
stageTimeByRoleP85:   buildRoleSeries(metricRows("stage-time-breakdown"),  ["dev","qa","po"], "p85"),
stageTimeShare:       buildRoleSeries(metricRows("stage-time-breakdown"),  ["dev","qa","po"], "avgShare"),
wipPerRole:           buildRoleSeries(metricRows("wip-per-role"),           ["dev","qa","po"], "count"),
stageThroughputNet:   buildRoleSeries(metricRows("stage-throughput-gap"),  ["dev","qa","po"], "avgNet"),
handoffReworkRatio:   buildSeries(metricRows("handoff-rework"), "", ["reworkRatio", "avgReworks"]),
handoffReworkByType:  buildSeries(metricRows("handoff-rework"), "qaToDev", ["count"])
                      // + qa et po agrégés en JS côté client
ftrByRole:            buildRoleSeries(metricRows("first-time-right"), ["dev","qa","po"], "ftrRate"),
```

Note : pour `handoffReworkByType`, les 3 buckets (qaToDev/poToQa/poDev) sont passés séparément dans le JSON et combinés en JS dans le rendu.

### 2c. KPIs (après ligne ~204)

```typescript
stageTimeDevMedian: pickValue(latestRows, "stage-time-breakdown", "dev", "median"),
stageTimeQaMedian:  pickValue(latestRows, "stage-time-breakdown", "qa",  "median"),
stageTimePoMedian:  pickValue(latestRows, "stage-time-breakdown", "po",  "median"),
wipDev:  pickValue(latestRows, "wip-per-role", "dev", "count"),
wipQa:   pickValue(latestRows, "wip-per-role", "qa",  "count"),
wipPo:   pickValue(latestRows, "wip-per-role", "po",  "count"),
reworkRatio:  pickValue(latestRows, "handoff-rework", "", "reworkRatio"),
avgReworks:   pickValue(latestRows, "handoff-rework", "", "avgReworks"),
ftrDev: pickValue(latestRows, "first-time-right", "dev", "ftrRate"),
ftrQa:  pickValue(latestRows, "first-time-right", "qa",  "ftrRate"),
ftrPo:  pickValue(latestRows, "first-time-right", "po",  "ftrRate"),
```

### 2d. `RenderInput` — champs à ajouter

```typescript
// Déjà dans charts et kpis — pas de nouveaux champs top-level dans RenderInput.
// Les données role-aware sont portées par charts et kpis existants.
```

### 2e. HELP_TEXTS — 5 nouvelles entrées

```typescript
stageTimeBreakdown: {
  title: "Stage time breakdown",
  body: "Temps médian passé par chaque rôle (dev/qa/po) sur les tickets cycle-time. Révèle où le temps est consommé dans le flux.",
},
wipPerRole: {
  title: "WIP par rôle",
  body: "Nombre de tickets en cours par rôle à chaque fin de semaine. Identifier quel rôle accumule du WIP non limitée.",
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
```

### 2f. HTML — nouvelle section

Après la section `<h2>Capacité &amp; prévision</h2>` et le tableau forecast + aging, ajouter :

```html
<h2>Flux par rôle</h2>
<!-- KPI stage-time-breakdown -->
<h3>Stage time breakdown${helpBtn("stageTimeBreakdown")}</h3>
<div class="kpis">
  <div class="kpi"><span class="label">Médiane dev</span><span class="value">${fmt(input.kpis.stageTimeDevMedian)}</span></div>
  <div class="kpi"><span class="label">Médiane qa</span><span class="value">${fmt(input.kpis.stageTimeQaMedian)}</span></div>
  <div class="kpi"><span class="label">Médiane po</span><span class="value">${fmt(input.kpis.stageTimePoMedian)}</span></div>
</div>
<div class="charts">
  <div class="chart-card"><h3>Temps médian par rôle (jours)</h3><canvas id="stageTimeByRoleChart"></canvas></div>
  <div class="chart-card"><h3>Répartition moyenne du cycle time</h3><canvas id="stageTimeShareChart"></canvas></div>
</div>

<!-- WIP par rôle -->
<h3>WIP par rôle${helpBtn("wipPerRole")}</h3>
<div class="kpis">
  <div class="kpi"><span class="label">WIP dev</span><span class="value">${fmtInt(input.kpis.wipDev)}</span></div>
  <div class="kpi"><span class="label">WIP qa</span><span class="value">${fmtInt(input.kpis.wipQa)}</span></div>
  <div class="kpi"><span class="label">WIP po</span><span class="value">${fmtInt(input.kpis.wipPo)}</span></div>
</div>
<div class="chart-card"><canvas id="wipPerRoleChart"></canvas></div>

<!-- Stage throughput gap -->
<h3>Stage throughput gap${helpBtn("stageThroughputGap")}</h3>
<div class="chart-card"><canvas id="stageThroughputGapChart"></canvas></div>

<!-- Handoff rework -->
<h3>Handoff rework${helpBtn("handoffRework")}</h3>
<div class="kpis">
  <div class="kpi"><span class="label">% tickets avec rework</span><span class="value">${fmtPct(input.kpis.reworkRatio)}</span></div>
  <div class="kpi"><span class="label">Reworks / ticket</span><span class="value">${fmt(input.kpis.avgReworks, "")}</span></div>
</div>
<div class="charts">
  <div class="chart-card"><h3>Taux de rework</h3><canvas id="reworkRatioChart"></canvas></div>
  <div class="chart-card"><h3>Reworks par type</h3><canvas id="reworkByTypeChart"></canvas></div>
</div>

<!-- First-time-right -->
<h3>First-time-right rate${helpBtn("firstTimeRight")}</h3>
<div class="kpis">
  <div class="kpi"><span class="label">FTR dev</span><span class="value">${fmtPct(input.kpis.ftrDev)}</span></div>
  <div class="kpi"><span class="label">FTR qa</span><span class="value">${fmtPct(input.kpis.ftrQa)}</span></div>
  <div class="kpi"><span class="label">FTR po</span><span class="value">${fmtPct(input.kpis.ftrPo)}</span></div>
</div>
<div class="chart-card"><canvas id="ftrByRoleChart"></canvas></div>
```

### 2g. JS Chart.js — rendu des 5 métriques

Dans le bloc `<script>`, après `renderBugBacklog()` (fin du script actuel) :

```javascript
const ROLE_CHARTS = ${JSON.stringify({ ... })}; // toutes les series role-aware

const COLOR_DEV = "#2563eb";
const COLOR_QA  = "#10b981";
const COLOR_PO  = "#f59e0b";

// stage-time-breakdown : barres groupées médiane + P85
(function renderStageTimeByRole() {
  // barres groupées dev/qa/po avec median et p85 — type "bar" groupé
})();

// stage-time-breakdown : donut avgShare (dernière snapshot)
(function renderStageTimeShare() {
  // type "doughnut" Chart.js
})();

// wip-per-role
lineChart("wipPerRoleChart", ROLE_CHARTS.wipPerRole, [
  { key: "dev", label: "WIP dev", color: COLOR_DEV },
  { key: "qa",  label: "WIP qa",  color: COLOR_QA  },
  { key: "po",  label: "WIP po",  color: COLOR_PO  },
]);

// stage-throughput-gap : barres groupées net par rôle
(function renderStageThroughputGap() {
  // type "bar" groupé avec axe Y pouvant être négatif (beginAtZero: false)
})();

// handoff-rework : courbe reworkRatio
lineChart("reworkRatioChart", ROLE_CHARTS.handoffReworkRatio, [
  { key: "reworkRatio", label: "Taux de rework", color: "#ef4444" },
], true);

// handoff-rework : barres par type
(function renderReworkByType() {
  // type "bar" groupé qaToDev / poToQa / poDev
})();

// first-time-right : courbe FTR par rôle
lineChart("ftrByRoleChart", ROLE_CHARTS.ftrByRole, [
  { key: "dev", label: "FTR dev", color: COLOR_DEV },
  { key: "qa",  label: "FTR qa",  color: COLOR_QA  },
  { key: "po",  label: "FTR po",  color: COLOR_PO  },
]);
```

La fonction `lineChart` existante accepte déjà une `ChartSeries` multi-clés — pas de modification nécessaire.

---

## Ordre d'implémentation

1. **Tests `extractStats` (rouge)** — cas pour chaque shape 022–025 + cas discriminateur `avgShareByRole` vs `byRole`
2. **`compute.ts`** — resserrer discriminateur `avgShareByRole` + 4 branches (tests passent au vert)
3. **Tests rapport (rouge)** — vérifier présence des canvas ids `stageTimeByRoleChart`, `wipPerRoleChart`, etc. dans le HTML rendu avec données mockées
4. **`generate.ts`** — `buildRoleSeries` + charts object + kpis + `RenderInput` + HELP_TEXTS + HTML + JS (tests passent au vert)
5. **`/simplify`** — réduire duplication dans les boucles `["dev","qa","po"]`

# Spec technique — KPIs : seuils dynamiques configurables

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Nouveau type `DynamicThresholdsConfig`, nouvelle fn `computeDynamicThresholds()`, modification `buildKpiCellsFromInput()` |
| `src/main.ts` | Étendre `HealthThresholds` avec `mode` et `windowWeeks` |

---

## 1. `src/main.ts` — Extension du type `HealthThresholds`

Actuellement (l. 141–148 de `generate.ts`, re-exporté via `main.ts`) :

```typescript
export interface HealthThresholds {
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}
```

Après modification :

```typescript
export interface HealthThresholds {
  mode?: "static" | "dynamic";   // défaut: "static"
  windowWeeks?: number;           // mode dynamic seulement, défaut: 12
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}
```

Aucune migration DB, aucun changement de `BoardFileConfig`. Le champ `mode` est ignoré silencieusement si absent (backward compat).

Validation dans `loadBoardConfig()` ou au runtime dans `generate.ts` : si `mode` est une valeur inconnue → `console.warn` + fallback `"static"`.

---

## 2. `src/report/generate.ts` — Calcul des seuils dynamiques

### 2a. Constante et type local

```typescript
const DYNAMIC_MIN_WEEKS = 4;

interface ResolvedThresholds {
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}
```

### 2b. Nouvelle fonction `computeDynamicThresholds()`

```typescript
export function computeDynamicThresholds(
  snapshots: SnapshotRow[],
  windowWeeks: number,
): ResolvedThresholds {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowWeeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const window = snapshots.filter((s) => s.snapshot_date >= cutoffStr);

  function extractSeries(metric: string, bucket: string, stat: string): number[] {
    return window
      .filter((s) => s.metric_name === metric && s.bucket === bucket && s.stat === stat)
      .map((s) => s.value)
      .filter((v) => v !== null) as number[];
  }

  function pct(values: number[], p: number): number | undefined {
    if (values.length < DYNAMIC_MIN_WEEKS) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[idx];
  }

  function lowerBetter(metric: string, bucket: string, stat: string): ThresholdPair | undefined {
    const vals = extractSeries(metric, bucket, stat);
    const warn = pct(vals, 50);
    const crit = pct(vals, 85);
    return warn !== undefined && crit !== undefined ? { warn, crit } : undefined;
  }

  function higherBetter(metric: string, bucket: string, stat: string): ThresholdPair | undefined {
    const vals = extractSeries(metric, bucket, stat);
    const warn = pct(vals, 50);
    const crit = pct(vals, 15);
    return warn !== undefined && crit !== undefined ? { warn, crit } : undefined;
  }

  return {
    leadTimeMedianDays:    lowerBetter("lead-time",         "", "median"),
    cycleTimeMedianDays:   lowerBetter("cycle-time",        "", "median"),
    bugCycleTimeMedianDays: lowerBetter("bug-cycle-time",   "", "median"),
    wipCount:              lowerBetter("wip",                "", "count"),
    bugRatio:              lowerBetter("dev-time-allocation","", "bugRatio"),
    throughputWeekly:      higherBetter("throughput",        "", "count"),
  };
}
```

### 2c. Nouvelle fonction `resolveThresholds()`

Fusionne seuils dynamiques et overrides statiques explicites :

```typescript
function resolveThresholds(
  config: HealthThresholds | undefined,
  snapshots: SnapshotRow[],
): ResolvedThresholds {
  if (!config) return {};

  const mode = config.mode ?? "static";

  if (mode !== "static" && mode !== "dynamic") {
    console.warn(`[report] healthThresholds.mode inconnu "${mode}", fallback "static".`);
  }

  if (mode !== "dynamic") {
    return config;
  }

  const dynamic = computeDynamicThresholds(snapshots, config.windowWeeks ?? 12);

  // Overrides statiques explicites écrasent le dynamique KPI par KPI
  return {
    leadTimeMedianDays:     config.leadTimeMedianDays    ?? dynamic.leadTimeMedianDays,
    cycleTimeMedianDays:    config.cycleTimeMedianDays   ?? dynamic.cycleTimeMedianDays,
    throughputWeekly:       config.throughputWeekly      ?? dynamic.throughputWeekly,
    wipCount:               config.wipCount              ?? dynamic.wipCount,
    bugCycleTimeMedianDays: config.bugCycleTimeMedianDays ?? dynamic.bugCycleTimeMedianDays,
    bugRatio:               config.bugRatio              ?? dynamic.bugRatio,
  };
}
```

### 2d. Modification de `generateReport()` / `buildRenderInput()`

Dans `generateReport()` (l. ~247), `healthThresholds` est passé directement à `buildRenderInput()`. Modifier pour appeler `resolveThresholds()` avec les snapshots complets avant construction du `RenderInput` :

```typescript
// avant
generateReport(db, ..., config.metrics?.healthThresholds, ...)

// dans generateReport(), avant construction de RenderInput :
const resolvedThresholds = resolveThresholds(healthThresholds, snapshots);
```

Le type de `RenderInput.healthThresholds` devient `ResolvedThresholds` (ou rester `HealthThresholds` — les deux interfaces ont la même forme, `mode`/`windowWeeks` sont simplement ignorés dans `buildKpiCellsFromInput`).

---

## Ordre d'implémentation

1. Étendre `HealthThresholds` dans `generate.ts` avec `mode` et `windowWeeks` (aucun risque de régression)
2. Écrire les tests (TDD) : `computeDynamicThresholds` + `resolveThresholds` avec snapshots fictifs
3. Implémenter `computeDynamicThresholds()` et `resolveThresholds()`
4. Brancher `resolveThresholds()` dans `generateReport()` en lieu et place du passage direct de `healthThresholds`
5. Tester end-to-end avec `config.fake.yaml` : ajouter `mode: dynamic` et vérifier les couleurs KPI

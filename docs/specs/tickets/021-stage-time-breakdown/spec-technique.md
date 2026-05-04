# Spec technique — Stage Time Breakdown

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/stageTimeBreakdown.ts` | Nouveau fichier — implémentation de la métrique |
| `src/metrics/index.ts` | Import + push dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Branch `"byRole" in result` dans `extractStats()` |

Dépendances : tickets 019 (RoleType + DerivedStatusConfig) et 020 (MetricConfig role groups +
`fetchDeliveredTransitions`, `groupByIssue`, `computeRoleDays`).

---

## 1. `src/metrics/stageTimeBreakdown.ts` — Nouveau fichier

### Types exportés

```typescript
import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import {
  fetchDeliveredTransitions, groupByIssue, computeRoleDays,
  statsFromDays, removeUpperOutliers, workingDaysBetween,
  type RoleStatuses, type DurationStats,
} from "./utils";

export interface StageTimeSummary {
  count: number;
  excludedOutliers: number;
  byRole: {
    dev: DurationStats;
    qa: DurationStats;
    po: DurationStats;
  };
  // Part moyenne du temps role-observable (dev+qa+po) passée dans chaque rôle.
  // Undefined si aucun ticket n'a de role-days > 0.
  avgShareByRole: {
    dev: number;
    qa: number;
    po: number;
  };
}
```

### Implémentation

```typescript
export const stageTimeBreakdownMetric: Metric<StageTimeSummary> = {
  name: "stage-time-breakdown",
  description:
    "Temps médian passé dans chaque rôle (dev/qa/po) sur la population cycle-time. Révèle où le lead time est consommé.",

  compute(db: Database.Database, config: MetricConfig): StageTimeSummary {
    const roles: RoleStatuses = {
      devStatuses: config.devStatuses ?? [],
      qaStatuses: config.qaStatuses ?? [],
      poStatuses: config.poStatuses ?? [],
    };

    const allEmpty = roles.devStatuses.length === 0
      && roles.qaStatuses.length === 0
      && roles.poStatuses.length === 0;

    if (allEmpty) {
      console.warn("  ⚠ stage-time-breakdown : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes");
      return emptyResult();
    }

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);

    // Calcul cycle time total par issue pour le filtre outliers
    const rawIssues: Array<{
      key: string;
      done_at: string;
      devDays: number;
      qaDays: number;
      poDays: number;
      cycleDays: number;
    }> = [];

    for (const [key, transitions] of byIssue) {
      const done_at = transitions[0].done_at;
      const started_at = transitions[0].started_at;
      const { devDays, qaDays, poDays } = computeRoleDays(transitions, done_at, roles);
      const cycleDays = workingDaysBetween(started_at, done_at);
      rawIssues.push({ key, done_at, devDays, qaDays, poDays, cycleDays });
    }

    // Filtre outliers sur cycle time total (cohérent avec cycle-time metric)
    let kept = rawIssues;
    let excluded = 0;
    if (config.excludeOutliers !== false && rawIssues.length >= 4) {
      const totals = rawIssues.map((i) => i.cycleDays);
      const { kept: keptTotals } = removeUpperOutliers(totals);
      const upper = keptTotals.length > 0 ? keptTotals[keptTotals.length - 1] : Infinity;
      kept = rawIssues.filter((i) => i.cycleDays <= upper);
      excluded = rawIssues.length - kept.length;
    }

    const devArr = kept.map((i) => i.devDays);
    const qaArr = kept.map((i) => i.qaDays);
    const poArr = kept.map((i) => i.poDays);

    // avgShare : part de (dev+qa+po) par rôle, tickets où somme > 0 seulement
    let sumDev = 0; let sumQa = 0; let sumPo = 0; let shareCount = 0;
    for (const i of kept) {
      const total = i.devDays + i.qaDays + i.poDays;
      if (total > 0) {
        sumDev += i.devDays / total;
        sumQa += i.qaDays / total;
        sumPo += i.poDays / total;
        shareCount++;
      }
    }
    const avgShare = shareCount > 0
      ? { dev: sumDev / shareCount, qa: sumQa / shareCount, po: sumPo / shareCount }
      : { dev: 0, qa: 0, po: 0 };

    return {
      count: kept.length,
      excludedOutliers: excluded,
      byRole: {
        dev: statsFromDays(devArr, false),
        qa: statsFromDays(qaArr, false),
        po: statsFromDays(poArr, false),
      },
      avgShareByRole: avgShare,
    };
  },
};
```

Note : `statsFromDays(arr, false)` — pas de double-filtre outliers (déjà filtré sur cycleDays
au niveau issue). Les `DurationStats` par rôle incluent les tickets à 0j dans ce rôle (count
= nombre de tickets retenus, pas seulement ceux ayant des jours dans ce rôle).

---

## 2. `src/metrics/index.ts`

```typescript
import { stageTimeBreakdownMetric } from "./stageTimeBreakdown";

const ALL_METRICS = [
  // ... métriques existantes ...
  stageTimeBreakdownMetric,   // ← ajout en fin de liste
];
```

---

## 3. `src/snapshots/compute.ts` — `extractStats()`

Ajouter une branch dédiée après le bloc `"aggregateFlowEfficiency"` (ligne 127) :

```typescript
} else if ("byRole" in result) {
  const r = result as unknown as StageTimeSummary;
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
  for (const role of ["dev", "qa", "po"] as const) {
    const s = r.byRole[role];
    if (s.count === 0) {continue;}
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "median", value: s.medianDays });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "p85", value: s.p85Days });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgShare", value: r.avgShareByRole[role] });
  }
}
```

Import à ajouter en tête de `compute.ts` :
```typescript
import { type StageTimeSummary } from "../metrics/stageTimeBreakdown";
```

Fenêtre snapshot : 30-day rolling (défaut pour métriques duration — cf. `ROLLING_WINDOW_DAYS`).

---

## Ordre d'implémentation

1. Écrire les tests TDD pour `stageTimeBreakdownMetric.compute()` (mock DB)
2. Créer `src/metrics/stageTimeBreakdown.ts` avec `emptyResult()` → tests rouges
3. Implémenter jusqu'à tests verts
4. Ajouter dans `ALL_METRICS` (`index.ts`)
5. Ajouter branch `extractStats` + import dans `compute.ts`
6. Vérifier `npm run metrics -m stage-time-breakdown` et `npm run snapshots`

## Notes

`printResults()` dans `main.ts` n'a pas de branch pour `byRole` — la métrique sera affichée
en fallback (rien) lors d'un `npm run metrics` sans JSON. Ajouter le rendu console dans
`main.ts` fait partie de ce ticket (sinon métrique invisible en CLI). Voir pattern
`aggregateFlowEfficiency` (lignes 642–652 de `main.ts`) comme modèle pour le rendu.

# Spec technique — Bottleneck Analysis

## Impact fichiers

| Fichier | Modification |
|---------|-------------|
| `src/metrics/bottleneckAnalysis.ts` | Nouveau fichier — implémente `Metric<BottleneckAnalysisResult>` |
| `src/metrics/index.ts` | Import + push `bottleneckAnalysisMetric` dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Import type + nouvelle branche dans `extractStats` |
| `src/report/generate.ts` | Import métrique + panneau diagnostic + graphe évolution scores |

---

## 1. `src/metrics/bottleneckAnalysis.ts`

### Types exportés

```typescript
export type RoleKey = "dev" | "qa" | "po";
export type BottleneckSignal = "accumulation" | "stage_time" | "rework" | "ftr" | "combined";

export interface RoleSignals {
  stageTimeMedianDays: number;   // temps médian dans ce rôle (jours ouvrés)
  avgNetFlow: number;            // moyenne (entrées − sorties) / semaine, positif = accumulation
  reworkInboundRate: number;     // % tickets revenus dans ce rôle après en être sortis (0–1)
  ftrPenalty: number;            // 1 − ftrRate (0–1)
}

export interface RoleBottleneckScore {
  score: number;                 // 0–1 composite, 1 = pire
  rank: number;                  // 1 = pire bottleneck, 2 = médian, 3 = meilleur
  dominantSignal: BottleneckSignal;
  signals: RoleSignals;
}

export interface BottleneckAnalysisResult {
  count: number;
  primaryBottleneck: RoleKey | null;
  recommendation: string;
  byRole: Record<RoleKey, RoleBottleneckScore>;
}
```

### Logique de calcul

**Étape 1 — Collecter les signaux bruts**

Réutilise exactement les helpers existants :

```typescript
import {
  fetchDeliveredTransitions,
  groupByIssue,
  computeRoleDays,
  toRoleStatuses,
  statsFromDays,
  workingDaysBetween,
} from "./utils";
```

- `stageTimeMedianDays` : calculé via `computeRoleDays` + `statsFromDays` → `medianDays`, identique à `stageTimeBreakdown` (lignes 59-87 de `stageTimeBreakdown.ts`).
- `avgNetFlow` : requête SQL identique à `stageThroughputGap.ts` lignes 49-59 ; calculer `avgNetByRole` directement (lignes 122-126 du même fichier).
- `reworkInboundRate` : calculé via la même logique que `handoffRework.ts` (lignes 57-83). Rework inbound par rôle :
  - dev : transitions `qa→dev` + `po→dev` / total issues
  - qa : transitions `po→qa` / total issues
  - po : 0 (rien ne revient vers po dans l'ordre naturel)
- `ftrPenalty` : calculé via la même logique que `firstTimeRight.ts` (lignes 51-73) → `1 − ftrRate` par rôle.

**Étape 2 — Normaliser par ranking relatif**

```typescript
function rankNormalize(values: number[]): number[] {
  // Retourne [0, 0.5, 1] assignés aux rangs croissants (plus petit = meilleur)
  // Ex: [3.2, 1.1, 5.8] → [0.5, 0, 1]
  const sorted = [...values].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const result = new Array(values.length).fill(0);
  sorted.forEach(({ i }, rank) => {
    result[i] = values.length === 1 ? 0 : rank / (values.length - 1);
  });
  return result;
}
```

Appliquer `rankNormalize` séparément sur chaque signal (vecteur de 3 valeurs, une par rôle).

**Étape 3 — Score composite**

```typescript
score[role] = (rankStageTime[role] + rankNetFlow[role] + rankRework[role] + rankFtr[role]) / 4;
```

**Étape 4 — Signal dominant**

Pour chaque rôle, trouver le signal avec le rang normalisé le plus élevé. Si l'écart entre le
plus haut et le deuxième plus haut est < 0.1 → `"combined"`. Priorité en cas d'égalité exacte :
`accumulation > stage_time > rework > ftr`.

**Étape 5 — Recommandation**

```typescript
const RECOMMENDATIONS: Record<BottleneckSignal, (role: RoleKey) => string> = {
  accumulation: (r) => `Réduire les entrées en ${r} ou augmenter la capacité disponible à ce stage.`,
  stage_time:   (r) => `Décomposer les tâches avant ${r} pour réduire le temps de passage unitaire.`,
  rework:       (r) => `Améliorer les critères d'entrée en ${r} (Definition of Ready) pour éviter les retours.`,
  ftr:          (r) => `Renforcer les critères de sortie de ${r} (Definition of Done) pour éviter les rejets.`,
  combined:     (r) => `Plusieurs signaux convergent sur ${r} — analyser la charge et la qualité simultanément.`,
};
```

Si `primaryBottleneck === null` → `recommendation: ""`.

**Étape 6 — Assign ranks**

Trier les rôles par score décroissant. Rang 1 = score le plus élevé. En cas d'égalité exacte,
ordre stable alphabétique (dev < po < qa).

---

## 2. `src/metrics/index.ts`

```typescript
import { bottleneckAnalysisMetric } from "./bottleneckAnalysis";
// ...
const ALL_METRICS = [
  // ... métriques existantes ...
  bottleneckAnalysisMetric,
];
```

---

## 3. `src/snapshots/compute.ts`

Ajout d'un import en tête de fichier :

```typescript
import { type BottleneckAnalysisResult } from "../metrics/bottleneckAnalysis";
```

Nouvelle branche dans `extractStats` (après la branche `"ftrByRole"` ligne 193) :

```typescript
} else if ("primaryBottleneck" in result) {
  const r = result as unknown as BottleneckAnalysisResult;
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
  for (const role of ["dev", "qa", "po"] as const) {
    const s = r.byRole[role];
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "score", value: s.score });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "rank", value: s.rank });
  }
}
```

Fenêtre snapshot : 30j glissants (même que `stage-time-breakdown`, `handoff-rework`, `first-time-right`). Aucun skip nécessaire — métrique déterministe.

---

---

## 4. `src/report/generate.ts`

### Import

```typescript
import { bottleneckAnalysisMetric, type BottleneckAnalysisResult } from "../metrics/bottleneckAnalysis";
```

### Calcul live (comme agingWip/forecast)

Dans `generateReport`, après la ligne `const scopeData = ...` :

```typescript
const bottleneck = bottleneckAnalysisMetric.compute(db, config);
```

### Données chart (snapshots)

Dans le bloc `charts` (ligne ~206) :

```typescript
bottleneckScores: buildRoleSeries(metricRows("bottleneck-analysis"), ["dev", "qa", "po"], "score"),
```

### Rendu HTML

Nouvelle fonction `buildBottleneckSection(bottleneck: BottleneckAnalysisResult, chartCfg: string): string`.

**Panneau de diagnostic** : badge coloré selon score du `primaryBottleneck` :
- score ≥ 0.6 → classe CSS `badge-red`
- score 0.4–0.6 → `badge-orange`
- score < 0.4 → `badge-green`

Mini-barres de score par rôle : `style="width: ${Math.round(score * 100)}%"` dans une `div.score-bar`.

**Graphe** : `canvas id="bottleneckScoresChart"`, même pattern que `wipPerRole` ou `stageTimeByRole`.
Chart.js `type: "line"`, 3 datasets (dev/qa/po), axe Y `min: 0, max: 1`.

La section est insérée dans la zone role-aware du rapport, avant `stageTimeBreakdown`.

Si `bottleneck.count === 0` → afficher `<p class="text-dim">Données insuffisantes.</p>` à la place.

---

## Ordre d'implémentation

1. `src/metrics/bottleneckAnalysis.ts` — fonctions privées d'abord (`rankNormalize`, collectors de signaux), puis `compute`, puis types exportés.
2. Tests unitaires (fichier à créer selon convention du projet).
3. `src/metrics/index.ts` — ajout import + push.
4. `src/snapshots/compute.ts` — import type + branche `extractStats`.
5. `src/report/generate.ts` — import + calcul live + chart series + `buildBottleneckSection`.
6. Vérifier `npm run metrics -m bottleneck-analysis` puis `npm run refresh` sur données réelles.

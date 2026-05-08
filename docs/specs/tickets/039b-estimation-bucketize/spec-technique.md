# Spec technique — Bucketize par méthode d'estimation

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/utils.ts` | `bucketize()` nouvelle signature + `getBucketLabels()` |
| `src/metrics/types.ts` | `MetricConfig` + champ `estimation: EstimationConfig` |
| `src/metrics/leadTimeBySize.ts` | SQL sélectionne `story_points`, `size_label` + appel bucketize mis à jour |
| `src/metrics/cycleTimeBySize.ts` | Idem leadTimeBySize |
| `src/metrics/leadTimeNormalized.ts` | Garde `disabled` si `method !== "time"` |
| `src/metrics/cycleTimeNormalized.ts` | Idem leadTimeNormalized |
| `src/main.ts` | `buildMetricConfig()` propage `estimation` |

---

## 1. `src/metrics/utils.ts`

> `utils.ts` importe depuis `./types` (pas depuis `../main`) — aucune dépendance circulaire.

```typescript
import type { EstimationConfig, EstimationMethod } from "./types";
```

### Défauts de seuils par méthode

```typescript
const DEFAULT_THRESHOLDS: Partial<Record<
  EstimationMethod,
  import("../main").EstimationBucketThresholds
>> = {
  time:           { xs: 0.5, s: 1, m: 3,  l: 5  },
  "story-points": { xs: 1,   s: 3, m: 8,  l: 13 },
};

function resolveThresholds(
  estimation: EstimationConfig,
): import("../main").EstimationBucketThresholds {
  const defaults = DEFAULT_THRESHOLDS[estimation.method];
  if (!defaults && !estimation.bucketThresholds) {
    throw new Error(`metrics.estimation.method="${estimation.method}" requiert bucketThresholds`);
  }
  return { ...defaults, ...estimation.bucketThresholds };
}
```

### Nouvelle signature de `bucketize()`

```typescript
export interface IssueEstimation {
  originalEstimateSeconds: number | null | undefined;
  storyPoints: number | null | undefined;
  sizeLabel: string | null | undefined;
}

export function bucketize(
  issue: IssueEstimation,
  isBug: boolean,
  estimation: EstimationConfig,
): SizeBucket {
  if (isBug) return "BUG";

  const { method } = estimation;

  if (method === "none") return "UNESTIMATED";

  if (method === "t-shirt") {
    return (issue.sizeLabel as SizeBucket | null) ?? "UNESTIMATED";
  }

  if (method === "story-points" || method === "numeric") {
    if (issue.storyPoints == null || issue.storyPoints <= 0) return "UNESTIMATED";
    const t = resolveThresholds(estimation);
    const sp = issue.storyPoints;
    if (sp < t.xs) return "XS";
    if (sp < t.s)  return "S";
    if (sp < t.m)  return "M";
    if (sp < t.l)  return "L";
    return "XL";
  }

  // method === "time"
  const sec = issue.originalEstimateSeconds;
  if (sec == null || sec <= 0) return "UNESTIMATED";
  const t = resolveThresholds(estimation);
  const days = sec / SECONDS_PER_DAY;
  if (days < t.xs) return "XS";
  if (days < t.s)  return "S";
  if (days < t.m)  return "M";
  if (days < t.l)  return "L";
  return "XL";
}
```

### `getBucketLabels()` — labels adaptés à la méthode

```typescript
export function getBucketLabels(
  estimation: EstimationConfig,
): Record<SizeBucket, string> {
  const m = estimation.method;

  if (m === "t-shirt") {
    return { XS: "XS", S: "S", M: "M", L: "L", XL: "XL", BUG: "BUG", UNESTIMATED: "UNESTIMATED" };
  }

  if (m === "story-points" || m === "numeric") {
    const t = resolveThresholds(estimation);
    const unit = m === "story-points" ? " SP" : "";
    return {
      XS: `XS (<${t.xs}${unit})`,
      S:  `S (${t.xs}-${t.s}${unit})`,
      M:  `M (${t.s}-${t.m}${unit})`,
      L:  `L (${t.m}-${t.l}${unit})`,
      XL: `XL (≥${t.l}${unit})`,
      BUG: "BUG",
      UNESTIMATED: "UNESTIMATED",
    };
  }

  if (m === "none") {
    return { XS: "UNESTIMATED", S: "UNESTIMATED", M: "UNESTIMATED", L: "UNESTIMATED",
             XL: "UNESTIMATED", BUG: "BUG", UNESTIMATED: "UNESTIMATED" };
  }

  // "time" : labels existants
  return BUCKET_LABELS;
}
```

---

## 2. `src/metrics/types.ts`

```typescript
import type { EstimationConfig } from "../main";

export interface MetricConfig {
  // ... champs existants ...
  estimation: EstimationConfig;  // défaut { method: "time" } injecté par buildMetricConfig()
}
```

---

## 3. `src/metrics/leadTimeBySize.ts`

SQL : ajouter `story_points`, `size_label` dans le SELECT (ligne ~35) :

```typescript
SELECT t.issue_key, MIN(t.transitioned_at) AS todo_at, d.done_at,
       i.original_estimate_seconds, i.story_points, i.size_label, i.issue_type
```

Type de la row :

```typescript
} as {
  issue_key: string;
  todo_at: string;
  done_at: string;
  original_estimate_seconds: number | null;
  story_points: number | null;
  size_label: string | null;
  issue_type: string;
}[]
```

Appel `bucketize()` (ligne ~63) :

```typescript
const bucket = bucketize(
  {
    originalEstimateSeconds: r.original_estimate_seconds,
    storyPoints: r.story_points,
    sizeLabel: r.size_label,
  },
  bugTypes.has(r.issue_type),
  config.estimation,
);
```

---

## 4. `src/metrics/cycleTimeBySize.ts`

Même pattern que `leadTimeBySize.ts` : ajouter `story_points`/`size_label` dans le SELECT, mettre à jour l'appel `bucketize()`.

---

## 5. `src/main.ts`

Dans `buildMetricConfig()` (ligne ~163) :

```typescript
return {
  // ... champs existants ...
  estimation: app.metrics?.estimation ?? { method: "time" },
};
```

Validation de `bucketThresholds` pour `numeric` (dans `validateEstimationConfig()` de 039a) :

```typescript
if (cfg.method === "numeric" && !cfg.bucketThresholds) {
  console.error(`Erreur : metrics.estimation.method="numeric" requiert metrics.estimation.bucketThresholds`);
  process.exit(1);
}
```

---

## 6. `src/metrics/leadTimeNormalized.ts` + `src/metrics/cycleTimeNormalized.ts`

> **Risque 3** : ces métriques filtrent `original_estimate_seconds > 0`, qui sera quasi-NULL pour les équipes story-points/numeric/t-shirt. Sans garde, elles retournent `count=0` silencieusement en CLI — résultat trompeur.

Ajouter en tête de `compute()` dans chacune :

```typescript
compute(db, config) {
  if (config.estimation.method !== "time") {
    // original_estimate_seconds non renseigné hors mode time → ratio sans sens
    return { count: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0,
             excludedOutliers: 0, disabled: true } as DurationStats & { disabled: true };
  }
  // ... logique existante inchangée ...
}
```

Le CLI (`main.ts`) et le rapport (039d) vérifient `disabled: true` avant d'afficher. En CLI :

```typescript
if ((d as { disabled?: boolean }).disabled) {
  console.log(`  ${metric.name} : désactivé (requiert method: "time")`);
  return;
}
```

---

## Ordre d'implémentation

1. `metrics/types.ts` — ajouter `estimation` dans `MetricConfig`
2. `metrics/utils.ts` — `resolveThresholds()` + `bucketize()` + `getBucketLabels()`
3. `main.ts` — `buildMetricConfig()` propage `estimation` + validation `numeric`
4. `metrics/leadTimeBySize.ts` — SQL + appel bucketize
5. `metrics/cycleTimeBySize.ts` — SQL + appel bucketize
6. `metrics/leadTimeNormalized.ts` + `metrics/cycleTimeNormalized.ts` — garde `disabled`

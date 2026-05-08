# Spec fonctionnelle — Bucketize par méthode d'estimation

## Contexte

Après 039a, `story_points` et `size_label` sont stockés en DB mais `bucketize()` les ignore. Les métriques `lead-time-by-size` et `cycle-time-by-size` continuent d'utiliser uniquement `original_estimate_seconds`, produisant des buckets inutiles pour les équipes story-points ou t-shirt.

## Comportement attendu

### Règles de bucketize par méthode

| Méthode | Source | Conversion | Bucket |
|---|---|---|---|
| `time` | `original_estimate_seconds` | ÷ 28800 → jours | seuils en jours |
| `story-points` | `story_points` | valeur brute | seuils en SP |
| `numeric` | `story_points` (même colonne) | valeur brute | seuils configurés |
| `t-shirt` | `size_label` | mapping direct | "XS"→XS, "S"→S, etc. |
| `none` | — | — | toujours UNESTIMATED |

### Seuils par défaut de `bucketThresholds`

Si `bucketThresholds` absent, défauts selon méthode :

| Méthode | xs | s | m | l |
|---|---|---|---|---|
| `time` | 0.5j | 1j | 3j | 5j |
| `story-points` | 1 SP | 3 SP | 8 SP | 13 SP |
| `numeric` | **requis** — pas de défaut |
| `t-shirt` | ignoré |
| `none` | ignoré |

### Labels des buckets

`getBucketLabels(estimation)` retourne des labels adaptés à la méthode :

| Bucket | `time` | `story-points` | `numeric` | `t-shirt` | `none` |
|---|---|---|---|---|---|
| XS | "XS (<0.5j)" | "XS (<1 SP)" | "XS (<2)" | "XS" | "UNESTIMATED" |
| S | "S (0.5-1j)" | "S (1-3 SP)" | "S (2-5)" | "S" | — |
| UNESTIMATED | "UNESTIMATED" | "UNESTIMATED" | "UNESTIMATED" | "UNESTIMATED" | "UNESTIMATED" |

Pour `numeric`, les valeurs dans les labels reflètent les `bucketThresholds` configurés. Pas d'unité affichée (l'unité dépend du champ custom de l'équipe).

### `MetricConfig`

`MetricConfig` reçoit `estimation: EstimationConfig` (non-optionnel, fallback `{ method: "time" }` dans `buildMetricConfig()`).

## Cas limites

- `story_points = NULL` → UNESTIMATED
- `size_label = NULL` → UNESTIMATED
- Bug + `method: "none"` → BUG (la règle bug prime sur UNESTIMATED)
- `bucketThresholds` absent pour `numeric` → erreur au démarrage (pas de défaut sensé)
- `bucketThresholds` partiel (ex: seulement `xs`/`s`) → compléter avec les défauts de la méthode

## Métriques normalisées (`lead-time-normalized`, `cycle-time-normalized`)

> **Risque 3** : ces métriques divisent la durée réelle par `original_estimate_seconds`. Pour les équipes non-`time`, ce champ est quasi-NULL → `count = 0` sans message. Ce comportement silencieux est trompeur en CLI.

**Règle** : si `estimation.method !== "time"`, retourner immédiatement `{ ..., disabled: true }`. Le CLI affiche "désactivé (requiert method: time)". Le rapport (039d) masque ces sections pour toutes les méthodes sauf `time`.

**Conséquence sur le positionnement** : le message d'influence no-estimate des normalized (ratio élevé = estimations sans valeur prédictive) ne s'applique qu'aux équipes `time`. Pour les équipes SP, l'influence passe par les métriques flow (lead-time, cycle-time, forecast) directement.

## Ce qui ne change pas

- La liste `SizeBucket` = XS/S/M/L/XL/BUG/UNESTIMATED : inchangée
- `throughput-weighted` : inchangé (039c)
- `snapshots/compute.ts` : consomme les mêmes shapes, inchangé

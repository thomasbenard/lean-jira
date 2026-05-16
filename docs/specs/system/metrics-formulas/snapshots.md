# Snapshots — fenêtres de calcul

[← Index](../metrics-formulas.md)

`backfillSnapshots` (`src/snapshots/compute.ts`) calcule toutes les métriques pour chaque **dimanche** depuis `cutoffDate` jusqu'à aujourd'hui (`now()`), inséré dans `metric_snapshots` après `DELETE FROM metric_snapshots` (replace-all par snapshot run, dans une seule transaction).

**Génération des dates** (`generateWeekEndings`) : démarre à `cutoffDate`, avance jusqu'au prochain dimanche (`(7 − dayOfWeek) % 7`), puis +7j tant que `start ≤ now()`. Conséquence : la première date snapshottée peut être postérieure à `cutoffDate` jusqu'à 6 jours.

Pour chaque date D et chaque métrique :

| Type de métrique | Fenêtre appliquée |
|---|---|
| Durée (lead, cycle, normalized, bug-cycle, flow-efficiency) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| **By-size (lead-time-by-size, cycle-time-by-size) + aging-wip** | `cutoffDate = config.cutoffDate` (global), `windowEndDate = D` — cumulative depuis l'origine |
| Débit (throughput, bug-throughput, throughput-weighted, bug-backlog, dev-time-allocation) | `cutoffDate = D − 7j`, `windowEndDate = D` |
| WIP (`wip`, `wip-per-role`) | Routes dédiées hors `extractStats` (`computeHistoricWip` / `computeHistoricWipPerRole`) — pas de fenêtre glissante, point-in-time à D |
| Rework / qualité (`handoff-rework`, `first-time-right`) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| Flux rôles (`stage-throughput-gap`, `bottleneck-analysis`, `stage-time-breakdown`) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| `forecast` | **Skip** — Monte Carlo non déterministe, computé live en report |
| `scope-change-rate` | **Skip** — shape `bySprint` non mappable au format `(snapshot_date, bucket, stat)` |

**Pré-condition `WEEKLY_METRICS`** : `Set("throughput", "throughput-weighted", "bug-throughput", "dev-time-allocation", "bug-backlog")`. **`CUMULATIVE_METRICS`** : `Set("lead-time-by-size", "cycle-time-by-size", "aging-wip")`. Tout métrique hors de ces deux sets utilise la fenêtre 30j par défaut.

## `extractStats` — résolution des shapes

Discrimination par **présence de propriété**, ordre `if / else if` strict (premier match gagne) :

| Ordre | Discriminator | Stats stockées |
|---|---|---|
| 1 | `buckets` (Record<SizeBucket, DurationStats>) | `count`, `median`, `p85`, `p95` par bucket non-vide (`excludedOutliers` **non** persisté) |
| 2 | `avgDays` (DurationStats) — lead-time, cycle-time, lead-time-normalized, cycle-time-normalized, bug-cycle-time | `count`, `median`, `p85` |
| 3 | `riskCounts` (aging-wip) | `count`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p85`, `p95` |
| 4 | `aggregateFlowEfficiency` (flow-efficiency) | `count`, `aggregate`, `median`, `activeDays`, `queueDays` |
| 5 | `openCount` (bug-backlog) | `openCount`, `netFlow`, `created`, `closed` |
| 6 | `avgBugRatio` (dev-time-allocation) | `featureDays`, `bugDays`, `bugRatio` agrégés sur la fenêtre |
| 7 | `reworkRatio` (handoff-rework) | `count`, `reworkRatio`, `avgReworks`, `count` par bucket `qaToDev`/`poToQa`/`poDev` |
| 8 | `avgShareByRole` (stage-time-breakdown) | `count` (bucket `""`), puis `median`, `p85`, `avgShare` par bucket rôle non-vide |
| 9 | `primaryBottleneck` (bottleneck-analysis) — **doit précéder `byRole`** car `BottleneckAnalysisResult` contient les deux | `count` (bucket `""`), puis `score`, `rank` par bucket rôle |
| 10 | `byRole` (wip-per-role-like) — branche défensive, jamais atteinte en prod (route dédiée `computeHistoricWipPerRole`) | `count` par bucket rôle |
| 11 | `ftrByRole` (first-time-right) | `count` (bucket `""`), puis `eligible`, `ftrRate`, `avgPasses` par bucket rôle où `eligible > 0` |
| 12 | `avgNetByRole` (stage-throughput-gap) — **doit précéder `byWeek`** car `StageThroughputGapResult` contient les deux | `in`, `out`, `avgNet` par bucket rôle (toujours 3 buckets, pas de skip vide) |
| 13 | `byWeek` (throughput, bug-throughput, throughput-weighted) | `count` total ; `estimatedDays` total si la métrique pondère |

Tout résultat ne matchant aucune branche est silencieusement ignoré. Pour ajouter une métrique snapshottable avec une nouvelle forme, ajouter une branche dans `extractStats` et choisir un discriminator unique parmi les propriétés du résultat.

**Choix implicite — discrimination par propriété fragile** : si un futur résultat ajoute une propriété qui collide avec un discriminator existant en amont (ex. ajout de `avgDays` sur un type non-DurationStats), la branche capturée silencieusement changera. Aucun garde-fou type-level.

**Choix implicite — `bottleneck-analysis` perd `dominantSignal`, `dominantColumn`, `recommendation`, `byColumn`, `primaryColumn`** : seuls `count`, `score`, `rank` sont snapshottés. Impossible de tracer historiquement quel signal dominait. Live uniquement.

**Choix implicite — `stage-throughput-gap` stocke 3 buckets même quand un rôle est inactif** : contraste avec `ftrByRole` (skip si `eligible=0`) et `stage-time-breakdown` (skip si `count=0`). Diff transparente côté lecture mais non normalisée.

## WIP historique (`computeHistoricWip` / `computeHistoricWipPerRole`)

Pour chaque date D :
1. CTE `last_status` : pour chaque issue, `to_status` correspondant à `MAX(transitioned_at)` où `transitioned_at <= D`.
2. JOIN `issues i ON i.key = l.issue_key`.
3. Filtre : `l.to_status IN (inProgressStatuses)` (ou statuts du rôle pour `wip-per-role`) **ET** (`i.resolved_at IS NULL OR substr(i.resolved_at, 1, 10) > D`).

**Choix implicite — utilise `i.resolved_at` (Jira `resolutiondate`), PAS `done_at` team-done** : viole l'invariant "team-done vs resolutiondate" appliqué aux métriques de durée/débit. Conséquence : une issue en statut `inProgressStatuses` à D mais déjà team-done avant D (ex. transition manuelle vers "In Progress" après une ré-ouverture sans `resolutiondate` synchronisée) est comptée comme WIP. En pratique le risque est faible — `last_status` filtre déjà sur le dernier statut connu — mais l'asymétrie avec les autres métriques est notable.

**Choix implicite — `wip-per-role` historique sans warning si rôles vides** : `if (statuses.length === 0) {continue;}` → bucket non émis silencieusement, contrairement à la métrique live `wip-per-role` qui `console.warn`.

## Lecture par le rapport

Le rapport HTML lit `metric_snapshots` pour les tendances ; il appelle `agingWipMetric.compute(...)`, `forecastMetric.compute(...)`, `cycleTimeMetric.compute(...)`, `bottleneckAnalysisMetric.compute(...)` et `scopeChangeMetric.compute(...)` en direct pour la vue "état actuel" + scatter aging + histogramme + table forecast + bottleneck `byColumn` + détail scope-change par sprint.

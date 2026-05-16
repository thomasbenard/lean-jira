# Invariants clés

[← Index](../spec-technique.md)

Règles transverses non négociables. Toute nouvelle métrique ou évolution doit les respecter sous peine d'incohérence inter-métriques.

## 1. Delivery = team-done (jamais `resolutiondate`)

`done_at` d'une issue = **première transition vers un statut dont `statusCategory.key='done'`** (ou listé dans `board.legacyDoneStatuses` pour les statuts renommés absents de l'API). Calculé une seule fois par run dans `buildBaseMetricsContext` (`src/metrics/context.ts:76-81`) et exposé via `ctx.deliveredAt: Map<issueKey, isoDate>`.

```typescript
// src/metrics/context.ts:76-81
const doneSet = new Set(config.doneStatuses);
const deliveredAt = new Map<string, string>();
for (const [key, list] of transitionsByIssue) {
  const first = list.find((t) => doneSet.has(t.toStatus));
  if (first) { deliveredAt.set(key, first.transitionedAt); }
}
```

`issues.resolved_at` (= Jira `resolutiondate`) est conservé pour audit mais **aucune métrique ne doit le lire**. Rationale : sur KECK, statuts type "À valider" portent `statusCategory=done` et constituent la livraison côté équipe ; les tickets attendent souvent en queue PO post-dev. `resolutiondate` sur-compterait cette queue PO.

**Règle ajout métrique** : pour toute durée se terminant à la livraison → `const doneAt = ctx.deliveredAt.get(issueKey)`. Jamais de SQL direct sur `resolved_at`.

## 2. Durées en working days (Mon–Fri)

Toute durée métier est exprimée en **jours ouvrés** via `workingDaysBetween(fromISO, toISO)` (`src/metrics/utils.ts:11`). Le calcul exclut samedi/dimanche, supporte les fractions horaires (heures intra-jour comptées au prorata), et retourne `0` si `to <= from`.

Exceptions calendaires (jours calendaires explicites) :
- Bornes de fenêtre snapshot (`cutoffDate ± N days`) — calcul de la plage temporelle, pas une durée métier.
- `windowEndDate` — date pivot, pas une durée.

**Règle ajout métrique** : passer par `ctx.workingDaysBetween` (alias `workingDaysBetween` exposé sur le contexte). Jamais `(toMs - fromMs) / 86_400_000`.

## 3. Status taxonomy auto-dérivée + filtrage `doneSet`

Les listes de statuts utilisées par les métriques sont **dérivées de `board.columns`** par `deriveStatusConfig()` dans `main.ts`, jamais déclarées manuellement par métrique. Mapping :

| Champ `MetricConfig` | Source `board.yaml` |
|---|---|
| `todoStatuses` | columns `type: todo` |
| `devStartStatuses` | columns `devStart: true` |
| `inProgressStatuses` | columns `type: active` ∪ `type: queue` (filtré contre doneSet) |
| `activeStatuses` | columns `type: active` (filtré contre doneSet) |
| `queueStatuses` | columns `type: queue` (filtré contre doneSet) |
| `devStatuses` / `qaStatuses` / `poStatuses` | columns avec `role: dev`/`qa`/`po` |
| `doneStatuses` | columns `type: done` ∪ `board.legacyDoneStatuses` ∪ DB `statuses.category_key='done'` |

Le `doneSet` runtime = union DB-derived + config. Tous les statuts present dans `doneSet` sont **retirés** de `inProgressStatuses` / `activeStatuses` / `queueStatuses` au démarrage. Un statut done ne peut donc jamais polluer une mesure WIP ou flow. Warning logué listant les statuts retirés.

## 4. Population cycle-time = transition vers `devStartStatuses`

`ctx.cycleTimePopulation: CycleTimeSample[]` (`src/metrics/context.ts:84-92`) contient les issues remplissant **toutes** ces conditions :
- `issueType` ∉ `config.excludeIssueTypes`
- Au moins une transition vers un statut `devStartStatuses` (= `startedAt`)
- Au moins une transition vers un statut `doneStatuses` (= `doneAt`)
- `doneAt` dans `[cutoffDate, windowEndDate]`

Métriques partageant cette population : `cycle-time` + by-size + normalized, `flow-efficiency`, `aging-wip`, `dev-time-allocation`, `stage-time-breakdown`, `handoff-rework`, `first-time-right`, `rework-cost`.

`lead-time` n'utilise PAS cette population — il filtre sur `todoStatuses` (point de mesure de départ). C'est le seul écart documenté.

**Règle ajout métrique** : pour toute mesure post-dev-start → itérer `ctx.cycleTimePopulation`, ne jamais re-requêter la DB pour reconstruire la population.

## 5. Fenêtres de snapshot par type de métrique

Configurées dans `src/snapshots/compute.ts:18-27` :

| Type | Constante / Set | Fenêtre |
|---|---|---|
| Durée (défaut) | `DEFAULT_ROLLING_WINDOW_DAYS = 30` | 30j glissants (override `metrics.snapshotWindowDays`) |
| Débit hebdo | `WEEKLY_METRICS` (`throughput`, `bug-throughput`, `throughput-weighted`, `dev-time-allocation`, `bug-backlog`, `handoff-rework`, `first-time-right`) | `WEEK_DAYS = 7` |
| Cumulatif | `CUMULATIVE_METRICS` (`lead-time-by-size`, `cycle-time-by-size`, `aging-wip`, `rework-cost`) | depuis `cutoffDate` global |
| Skip | `SKIP_METRICS` (`wip`, `wip-per-role`, `forecast`, `scope-change-rate`, `duration-distribution`) | calcul historique custom ou non-déterministe |

`wip` et `wip-per-role` reconstruits via `computeHistoricWip` / `computeHistoricWipPerRole` (point-in-time sur `transitions` brutes, hors `MetricsContext`). `forecast` est non-déterministe (Monte Carlo) → recalculé live dans le rapport. `scope-change-rate` et `duration-distribution` n'ont pas de série temporelle pertinente.

Tout changement de `snapshotWindowDays` entre 2 runs détecté via `app_config` → recalcul intégral de `metric_snapshots`.

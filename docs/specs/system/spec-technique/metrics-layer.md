# Couche métriques

[← Index](../spec-technique.md)

## Interface plugin

```typescript
interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database, config: MetricConfig): T;
}
```

Enregistrement dans `ALL_METRICS` (`src/metrics/index.ts`). Chaque fichier `src/metrics/<name>.ts` implémente une métrique.

**Ajout d'une métrique** : implémenter `Metric<T>`, enregistrer dans `ALL_METRICS`, ajouter une branche `extractStats` dans `snapshots/compute.ts` si la shape de résultat est nouvelle (voir [`metrics-formulas.md`](../metrics-formulas.md) § Snapshots pour les shapes reconnues).

## `MetricConfig`

Construit par `buildMetricConfig(db, app)` dans `src/main.ts`. Les listes de statuts sont d'abord dérivées depuis `config.board.columns` via `deriveStatusConfig()`, puis `buildMetricConfig` construit le `doneSet` = union `statuses.category_key='done'` (DB) ∪ `derived.doneStatuses`. Les listes `inProgressStatuses` / `activeStatuses` / `queueStatuses` sont filtrées contre ce set : un statut done ne peut jamais polluer les métriques WIP/flow. Un warning liste les statuts retirés au démarrage.

| Champ | Description |
|---|---|
| `todoStatuses` | Début lead time |
| `devStartStatuses` | Début cycle time |
| `inProgressStatuses` | WIP (filtrés contre doneSet) |
| `activeStatuses` | Touch time pour flow-efficiency (filtrés) |
| `queueStatuses` | Queue time pour flow-efficiency (filtrés) |
| `devStatuses` | Statuts colonnes `role: dev` ; `[]` si aucun rôle configuré |
| `qaStatuses` | Statuts colonnes `role: qa` ; `[]` si aucun rôle configuré |
| `poStatuses` | Statuts colonnes `role: po` ; `[]` si aucun rôle configuré |
| `doneStatuses` | Union DB-derived + config legacy → définit `done_at` |
| `cutoffDate` | Borne basse (issues livrées avant ignorées) |
| `windowEndDate` | Borne haute (injecté par le système de snapshots) |
| `excludeOutliers` | Tukey upper fence, défaut `true` |
| `bugIssueTypes` | Types routés dans bucket BUG |

> Formules, primitives (`buildDeliveredCte`, `workingDaysBetween`, Tukey) et algorithmes détaillés par métrique : voir [`metrics-formulas.md`](../metrics-formulas.md).

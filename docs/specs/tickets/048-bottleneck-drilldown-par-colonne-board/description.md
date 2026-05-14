# Ticket 048 — Bottleneck drill-down par colonne board (pas par statut)

## User story

En tant que lead technique, je veux que le graphe "Drill-down by column" regroupe les données
par colonne board.yaml (ex. "Code Review") plutôt que par statut Jira individuel (ex. "In Review"),
afin de lire le goulot au niveau de la colonne fonctionnelle et non du statut technique.

## Solution retenue

Ajouter `statusToColumnName?: Record<string, string>` dans `MetricConfig`. `buildMetricConfig()`
construit ce mapping depuis `app.board.columns`. Dans `bottleneckAnalysis.ts`, la clé de
`columnDays` devient le nom de colonne (via `statusToColumnName`) plutôt que le statut Jira.
`ColumnStat.status` est renommé `ColumnStat.column`. `dominantColumn` sur chaque
`RoleBottleneckScore` stocke désormais un nom de colonne board. `buildColumnDrilldownHtml()`
dans `generate.ts` est mis à jour pour utiliser `c.column`.

## Estimation

**Bucket** : S

**Justification** : 4 fichiers touchés (`types.ts`, `main.ts`, `bottleneckAnalysis.ts`,
`generate.ts`) + tests. Pattern trivial (record lookup). Aucune migration DB. Changement de
champ sur `ColumnStat` (breaking interne, aucun consommateur externe).

## Statut

**livré**

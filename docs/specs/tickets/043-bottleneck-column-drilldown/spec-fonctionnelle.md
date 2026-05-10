# Spec fonctionnelle — Bottleneck analysis drill-down colonne

## Contexte

La métrique `bottleneck-analysis` identifie actuellement le rôle (dev/qa/po) qui constitue le
goulot d'étranglement principal. Quand un rôle comme "dev" comporte plusieurs colonnes (ex :
"In Progress" et "Code Review"), l'information reste trop agrégée pour savoir où intervenir.
Ce ticket descend d'un niveau : la colonne dominante au sein du rôle primaire.

## Comportement attendu

### Champ `dominantColumn` dans `RoleBottleneckScore`

Chaque rôle expose un champ `dominantColumn: string | null` : le statut dont le temps médian
est le plus élevé parmi tous les statuts appartenant à ce rôle sur la population cycle-time.

- Si le rôle n'a qu'un seul statut configuré → `dominantColumn` = ce statut.
- Si le rôle n'apparaît dans aucune transition livrée → `dominantColumn = null`.

### Champ `primaryColumn` dans `BottleneckAnalysisResult`

Raccourci : `dominantColumn` du `primaryBottleneck`. Vaut `null` si `primaryBottleneck` est
`null` ou si aucune transition ne couvre ce rôle.

### Affichage rapport

Dans le panel "Bottleneck Analysis" de l'onglet Rôles, la ligne de recommandation inclut
la colonne dominante :

> **DEV** (In Progress) — Décomposer les tâches avant dev pour réduire le temps de passage unitaire.

Format : `<ROLE> (<dominantColumn>)` si `primaryColumn` non nul, `<ROLE>` seul sinon (comportement
actuel inchangé).

## Cas limites

- Rôle avec tous les temps à 0 (issues qui ne passent jamais par ce rôle) → `dominantColumn = null`.
- Ex-æquo de médiane entre deux colonnes du même rôle → tiebreak alphabétique sur le nom du statut.
- Rôle avec un seul statut → `dominantColumn` = ce statut (pas de comparaison nécessaire).
- `primaryBottleneck` null (aucune issue livrée ou aucun rôle configuré) → `primaryColumn = null`.

## Ce qui ne change pas

- Le score composite par rôle (0–1) et le classement entre rôles ne changent pas.
- Les signaux `stageTimeMedianDays`, `avgNetFlow`, `reworkInboundRate`, `ftrPenalty` restent au
  niveau rôle (pas de décomposition par colonne pour ces signaux).
- Pas de snapshot de `dominantColumn` / `primaryColumn` dans `metric_snapshots`.
- Aucune modification au schéma DB ni aux helpers `utils.ts`.

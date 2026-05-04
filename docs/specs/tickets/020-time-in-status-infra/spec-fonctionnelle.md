# Spec fonctionnelle — Time-in-status infra

## Contexte

Les métriques Stage Time Breakdown (021), Handoff Detection (024) et First-Time-Right Rate
(025) ont besoin pour chaque ticket livré de la séquence ordonnée de ses transitions sur la
fenêtre cycle-time. `flowEfficiency.ts` fait déjà ce travail pour ses propres besoins, mais
de manière interne. Ce ticket extrait la logique en utilitaires réutilisables et étend
`MetricConfig` pour transporter les groupes role-based dérivés du ticket 019.

## Comportement attendu

### Groupes role dans `MetricConfig`

`MetricConfig` gagne trois champs optionnels :
- `devStatuses?: string[]` — statuts des colonnes `role: dev`
- `qaStatuses?: string[]` — statuts des colonnes `role: qa`
- `poStatuses?: string[]` — statuts des colonnes `role: po`

Quand `board.yaml` ne définit aucun `role` sur ses colonnes, ces trois champs sont des
tableaux vides `[]`. Les métriques existantes ignorent ces champs.

### `fetchDeliveredTransitions(db, config)`

Retourne toutes les transitions pour les tickets de la population cycle-time :
- Population : tickets livrés ayant une transition `devStartStatuses` ET une transition
  `todoStatuses` (cohérent avec `cycle-time` et `flow-efficiency`)
- Fenêtre : transitions entre `started_at` (premier devStart) et `done_at`
- Ordre : `key ASC, transitioned_at ASC, id ASC`
- Filtres : `cutoffDate`, `windowEndDate`, `excludeIssueTypes` appliqués
- Retour : `TransitionRow[]` — une ligne par transition

### `groupByIssue(rows)`

Transforme `TransitionRow[]` en `Map<string, TransitionRow[]>`. Chaque entrée de la Map
contient les transitions d'un seul ticket, déjà ordonnées (ordre préservé de l'input).

### `computeRoleDays(transitions, done_at, roleStatuses)`

Pour un seul ticket, calcule le temps en jours ouvrés passé dans chaque rôle :
- Itère sur les transitions consécutives (même logique que `flowEfficiency.ts` lignes 93–101)
- Calcule `workingDaysBetween(trans[i].transitioned_at, trans[i+1].transitioned_at)` (ou
  `done_at` pour la dernière transition)
- Accumule `devDays`, `qaDays`, `poDays` selon à quel groupe appartient `to_status`
- Statuts hors des trois rôles : ignorés (pas comptabilisés dans aucun groupe)
- Retour : `{ devDays: number; qaDays: number; poDays: number }`

## Cas limites

- Aucune colonne `role` configurée → `devStatuses/qaStatuses/poStatuses` vides → `computeRoleDays` retourne `{0, 0, 0}`
- Ticket passe plusieurs fois dans un rôle (rework) → durées cumulées dans le groupe
- Statut simultanément dans deux rôles → impossible par construction (une colonne = un rôle optionnel)
- Population vide (cutoffDate filtre tout) → `fetchDeliveredTransitions` retourne `[]`
- Transition vers statut "done" dans la fenêtre → capturée par `done_at`, pas par une transition

## Ce qui ne change pas

- Aucune métrique existante
- `buildDeliveredCte()`, `buildWindowFragment()`, `buildBugExclusionFragment()` inchangés
- `MetricConfig` reste rétrocompatible (champs optionnels)
- `DerivedStatusConfig` dans `src/main.ts` (défini par ticket 019)

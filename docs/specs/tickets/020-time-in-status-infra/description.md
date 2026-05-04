# Ticket 020 — Time-in-status infra

## User story

En tant que développeur implémentant les métriques role-aware (tickets 021–025), je veux
disposer d'un utilitaire partagé qui calcule le temps passé par statut pour chaque ticket
livré, afin d'éviter de dupliquer la même requête SQL dans chaque métrique.

## Solution retenue

Trois ajouts coordonnés :

1. **`MetricConfig`** (`src/metrics/types.ts`) — ajouter `devStatuses?`, `qaStatuses?`,
   `poStatuses?` en champs optionnels. Ces listes sont peuplées depuis `DerivedStatusConfig`
   (ticket 019) dans `buildMetricConfig()`.

2. **`buildMetricConfig()`** (`src/main.ts`) — transmettre les groupes role dérivés vers
   `MetricConfig`.

3. **Utilitaires** (`src/metrics/utils.ts`) — trois fonctions exportées :
   - `fetchDeliveredTransitions()` — requête SQL identique au cœur de `flowEfficiency.ts` :
     transitions ordonnées pour la population cycle-time (devStart + todo existence check),
     fenêtre `[started_at, done_at]`
   - `groupByIssue()` — regroupe les lignes en `Map<key, TransitionRow[]>`
   - `computeRoleDays()` — calcule `{devDays, qaDays, poDays}` pour un issue donné à
     partir de ses transitions et des listes de statuts par rôle

Aucune métrique existante n'est modifiée. Les nouveaux champs de `MetricConfig` sont
optionnels — les métriques existantes ignorent leur absence.

## Estimation

**Bucket** : M

**Justification** : 3 fichiers touchés (`src/metrics/types.ts`, `src/main.ts`,
`src/metrics/utils.ts`). Requête SQL calquée sur `flowEfficiency.ts` (pattern connu).
Extension de `MetricConfig` + propagation dans `buildMetricConfig`. 5–7 scénarios de test
(population vide, rôles absents, multiple passes par rôle, statut hors rôle ignoré).

## Statut

**livré**

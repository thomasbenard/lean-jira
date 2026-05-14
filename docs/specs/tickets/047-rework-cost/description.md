# Ticket 047 — Rework Cost

## User story

En tant que lead technique, je veux voir le coût en jours-ouvrés des retraitements par semaine et par sprint, afin de quantifier l'impact économique du rework sur la vélocité de l'équipe.

## Solution retenue

Nouvelle métrique `rework-cost` : pour chaque ticket livré de la population cycle-time, on identifie les passes rework (passages 2+ dans un même rôle) et on somme leurs durées en jours-ouvrés. Seul le temps passé dans les statuts de rôle est compté — `todoStatuses` et les statuts sans rôle agissent comme séparateurs de passes mais leur durée est exclue du coût. Les durées sont distribuées proportionnellement sur les semaines ISO (même logique que `dev-time-allocation`). Vue secondaire par sprint via `sprints.start_date / end_date` : un bloc rework est attribué au sprint actif à sa date de fin.

## Estimation

**Bucket** : M

**Justification** : 3 fichiers touchés — `src/metrics/reworkCost.ts` (nouveau, ~120 lignes), `src/metrics/index.ts` (+1 ligne), `src/snapshots/compute.ts` (+1 import + 1 branche `extractStats`). Algorithme non-trivial (détection blocs rework par passes, distribution proportionnelle hebdo, jointure sprints) mais tous les patterns existent dans le code existant (`handoffRework`, `firstTimeRight`, `devTimeAllocation`, `scopeChange`). 6–8 scénarios de test attendus.

## Statut

**livré**

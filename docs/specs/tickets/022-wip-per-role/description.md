# Ticket 022 — WIP par rôle

## User story

En tant que lead technique en daily standup, je veux voir combien de tickets sont actuellement
en cours dans chaque rôle (dev, qa, po), afin de détecter immédiatement quel rôle est saturé
ou bloqué.

## Solution retenue

Nouvelle métrique `wip-per-role` implémentant `Metric<WipPerRoleResult>`. Pour chaque rôle
configuré, compte les issues dont `current_status IN (roleStatuses)` dans la table `issues`.
Pas de scoping sprint (contrairement à `wip`) : le WIP par rôle reflète l'état global du
board. Snapshot point-in-time (comme `wip`), géré via `computeHistoricWip` analogue dans
`compute.ts`. Retourne vide si aucun rôle configuré.

## Estimation

**Bucket** : S

**Justification** : 1 nouveau fichier court (`src/metrics/wipPerRole.ts`), 2 fichiers modifiés
(`index.ts`, `compute.ts`). Requête SQL triviale, pas de calcul de durée. 3–4 scénarios test.

## Statut

**à faire**

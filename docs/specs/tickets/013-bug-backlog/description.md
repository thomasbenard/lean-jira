# Ticket 013 — Métrique bug-backlog

## User story

En tant que lead technique, je veux voir l'évolution du nombre de bugs ouverts et du flux net
hebdomadaire (fermés − créés) sur le rapport, afin de détecter si le backlog de bugs grossit
ou se résorbe dans le temps.

## Solution retenue

Nouvelle métrique `bug-backlog` qui calcule, pour chaque fenêtre hebdomadaire :
- `openCount` : nombre de bugs ouverts à la date de fin de fenêtre (reconstruit depuis
  `issues.created_at` et `transitions` vers un statut done)
- `netFlow` : bugs fermés − bugs créés dans la semaine (positif = backlog réduit)
- `created` / `closed` : chiffres bruts pour débogage

La métrique est ajoutée à `WEEKLY_METRICS` dans `snapshots/compute.ts` et reçoit une nouvelle
branche dans `extractStats`. Le rapport affiche un graphe double-axe : courbe openCount
(axe gauche, absolu) + barres netFlow (axe droit, delta).

Pas de scoping sprint : tous les bugs ouverts comptent, quel que soit leur sprint.

## Estimation

**Bucket** : M

**Justification** : 4 fichiers touchés (nouveau `bugBacklog.ts`, modifications de `index.ts`,
`snapshots/compute.ts`, `report/generate.ts`), SQL multi-CTE sans pattern réutilisable
directement, nouvelle branche `extractStats`, ~6 scénarios TDD. Pas de migration DB nécessaire.

## Statut

**livré**

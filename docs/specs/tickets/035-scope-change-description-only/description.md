# Ticket 035 — scope-change-rate : détection description uniquement

## User story

En tant que lead technique, je veux que `scope-change-rate` ne remonte que les changements significatifs de description ou de summary, afin d'éliminer le bruit introduit par les réévaluations Story Points et les reprogrammations de sprint qui polluent le signal de dérive de périmètre.

## Solution retenue

Supprimer les branches de détection `storyPoints` et `sprintChange` dans `scopeChange.ts`. Simplifier en conséquence les interfaces `ScopeChangedIssueDetail` et `SprintScopeStats.byChangeType` (retirer les champs `storyPoints` et `sprintChange`). Mettre à jour le rendu dans `generate.ts` (colonne "Type" du tableau issues modifiées). `FIELD_STORY_POINTS` et la constante `FIELD_SPRINT` dans la boucle de détection disparaissent ; `FIELD_SPRINT` reste utilisé dans `findFirstSprint` pour l'attribution sprint.

Les champs `Story Points` et `Sprint` continuent d'être capturés dans `issue_field_changes` au sync (utile pour `findFirstSprint`) — aucun changement dans `sync.ts`.

## Estimation

**Bucket** : S

**Justification** : 2 fichiers src (`scopeChange.ts`, `generate.ts`) + 2 fichiers test. Suppressions uniquement — pas de nouvelle logique, pas de migration DB. 3-5 scénarios de test à retirer ou adapter (Règle 2 Story Points, Règle 4 Sprint change).

## Statut

**à faire**

# Ticket 034 — Corriger le dénominateur de scope-change-rate

## User story

En tant que lead technique, je veux que le taux de dérive de périmètre soit calculé sur la totalité des issues du sprint, afin d'éviter des taux artificiellement élevés liés à un sous-comptage du dénominateur.

## Solution retenue

Ajouter une table de jonction `issue_sprints (issue_key, sprint_id)` peuplée lors du sync depuis `customfield_10020` (champ Jira qui liste **tous** les sprints historiques d'une issue, pas seulement le sprint actif). La métrique `scope-change-rate` utilisera `issue_sprints JOIN sprints` pour calculer `totalIssues` par sprint (vrai effectif) et conserver `issue_field_changes` uniquement pour détecter les modifications post-entrée en sprint.

Le problème actuel : `totalIssues` compte uniquement les issues ayant au moins un changement de champ `Sprint` dans `issue_field_changes`. Les issues créées avant la première synchronisation ou sur une instance sans changelog complet sont silencieusement exclues du dénominateur, produisant des taux de dérive artificiellement proches de 100%.

## Estimation

**Bucket** : M

**Justification** : 4 fichiers touchés (`schema.sql`, `store.ts`, `sync.ts`, `scopeChange.ts`). Pattern `replaceAllFieldChanges` / `replaceAllTransitions` existant à dupliquer pour `replaceAllIssueSprints`. Migration DB triviale (nouvelle table, `CREATE TABLE IF NOT EXISTS` suffit). ~6-8 scénarios de test (dénominateur correct, issues multi-sprints, fallback base vide, exclusion issue types). Dépend du ticket 031 (issue_field_changes déjà en place).

## Statut

**livré**

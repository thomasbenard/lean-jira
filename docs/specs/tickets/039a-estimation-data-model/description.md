# Ticket 039a — Modèle de données estimation brute

## User story

En tant que lead technique configurant lean-jira pour son équipe, je veux déclarer la méthode d'estimation utilisée (temps, story points, taille de t-shirt, aucune) dans `board.yaml`, afin que les valeurs brutes d'estimation soient stockées en base et disponibles pour les métriques by-size.

## Solution retenue

Ajout de deux colonnes dans la table `issues` : `story_points REAL` (partagée entre story-points et numeric) et `size_label TEXT` (t-shirt). Cinq méthodes : `time` (défaut, inchangé), `story-points` (jiraField implicite : `customfield_10016`), `numeric` (jiraField obligatoire), `t-shirt` (jiraField obligatoire), `none`. Pas de propriété `weightField` — dérivé automatiquement depuis la méthode dans 039c. `jira/types.ts` gagne une index signature sur `fields` pour l'accès dynamique aux custom fields. Ce ticket ne modifie pas les métriques — valeurs stockées mais non consommées avant 039b.

## Estimation

**Bucket** : M

**Justification** : 5 fichiers touchés (schema.sql, store.ts, jira/types.ts, sync.ts, main.ts). Pattern migration DB existant dans `store.ts:migrate()` (lignes 19-27). Pas d'algorithme complexe. Pas de changement observable sur les métriques existantes.

## Statut

**à faire**

# Ticket 031 — Infra DB + sync : changements de champs Jira

## User story

En tant que lead technique, je veux que les changements de champs métier (description, summary, story points, sprint) soient persistés en base à chaque sync, afin de pouvoir calculer des métriques de détection de changement de périmètre dans les tickets suivants.

## Solution retenue

Le changelog Jira est déjà fetché (`expand: "changelog"`) dans `client.ts`. Il contient tous les changements de champs, pas seulement les transitions de statut. On ajoute une table `issue_field_changes` et on étend `sync.ts` pour extraire les entrées de changelog où `item.field` est dans la liste des champs surveillés (`description`, `summary`, `Story Points`, `Sprint`). Aucun nouvel appel API n'est nécessaire.

## Estimation

**Bucket** : S

**Justification** : 1 table SQL nouvelle, 3 fichiers touchés (`schema.sql`, `sync.ts`, `store.ts`), pattern existant (`extractTransitions` / `replaceAllTransitions`) directement duplicable. 3-4 scénarios de test. Pas de logique métier complexe — extraction et persistance brutes.

## Statut

**livré**

# Ticket 009 — Sync incrémental

## User story

En tant que lead technique, je veux que `npm run sync` ne récupère que les issues modifiées depuis le dernier sync, afin de réduire le temps d'exécution et le nombre d'appels à l'API Jira.

## Solution retenue

Lire la date du dernier sync depuis `sync_log` au démarrage du sync. Si une entrée existe, passer un filtre JQL `updated >= "<date>"` au paramètre `jql` de l'endpoint agile board (`/rest/agile/1.0/board/{boardId}/issue`). Si aucune entrée (premier sync), comportement inchangé : récupération complète. Les sprints et statuts sont toujours récupérés en entier (appels légers). Les transitions sont remplacées uniquement pour les issues effectivement récupérées.

## Estimation

**Bucket** : S (~1j)

**Justification** : 3 fichiers touchés (`store.ts`, `client.ts`, `sync.ts`). Pas de migration DB (la table `sync_log` existe déjà). Pattern simple : lire une ligne, passer un paramètre optionnel. Environ 5 scénarios de test attendus.

## Statut

**à faire**

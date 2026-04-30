# Ticket 004 — Rapport : indicateur de fraîcheur des données

## User story

En tant que membre de l'équipe consultant le rapport HTML, je veux voir quand les données Jira ont été synchronisées pour la dernière fois, afin de savoir si les métriques affichées sont fiables ou si un sync est nécessaire avant de prendre une décision.

## Solution retenue

Lire la date du dernier sync réussi depuis la table `sync_log` (colonne `synced_at`, MAX par `project_key`). Ajouter une nouvelle fonction `getLastSyncDate(db, projectKey)` dans `src/db/store.ts`. Afficher cette date dans l'en-tête du rapport à côté de la date de génération. Si le dernier sync date de plus de 7 jours, afficher un bandeau d'avertissement visuel (fond orange, icône ⚠). Aucune modification du schéma DB (la table `sync_log` existe déjà).

## Statut

**To be implemented**

# Flux de synchronisation (`sync.ts`)

[← Index](../spec-technique.md)

1. `GET /rest/api/2/status` → upsert `statuses` (avec `category_key`).
2. `GET /rest/agile/1.0/board/{boardId}/sprint` → upsert `sprints` (pagination 50/page, 200 ms entre pages).
3. Lecture de `sync_log` via `getLastSyncDate()` pour déterminer le mode sync :
   - **Premier sync** (aucune entrée) : récupération complète de toutes les issues.
   - **Sync incrémental** (entrée existante) : `GET …/issue?jql=updated>="<date>"` — seules les issues modifiées depuis le dernier sync sont récupérées. La date ISO est convertie en format JQL `"YYYY-MM-DD HH:MM"` avant injection.
4. Mappe chaque issue récupérée : `current_sprint_id` = sprint actif courant uniquement (ignore les sprints fermés historiques).
5. Upsert `issues` + `sprints` en transaction.
6. Pour chaque issue récupérée : `replaceTransitions` — DELETE + INSERT atomique dans `transitions`. Garantit cohérence si Jira modifie l'historique. Les issues non récupérées restent inchangées en base.
7. Log audit dans `sync_log` (nombre d'issues effectivement récupérées).

Champs récupérés par issue : `summary`, `issuetype`, `status`, `created`, `resolutiondate`, `assignee`, `priority`, `customfield_10020` (sprints), `timeoriginalestimate`.

**Bulk close 2025-10-25** : résilience assurée par `cutoffDate >= 2025-11-01` — les issues bulk-closées ont leur `done_at` le jour de la migration et sont donc exclues.

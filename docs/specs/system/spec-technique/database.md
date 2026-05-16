# Base de données (SQLite)

[← Index](../spec-technique.md)

WAL mode, foreign keys activées. Schéma auto-appliqué à l'ouverture (`schema.sql`). Colonnes ajoutées par migration PRAGMA détectée au démarrage.

## `issues`

Snapshot courant de chaque issue Jira.

| Colonne | Type | Description |
|---|---|---|
| `key` | TEXT PK | Clé Jira (ex. `PROJ-123`) |
| `summary` | TEXT | Titre |
| `issue_type` | TEXT | Type (Story, Bug, Task…) |
| `created_at` | TEXT | ISO 8601 |
| `resolved_at` | TEXT | `resolutiondate` Jira. **Audit uniquement — aucune métrique ne l'utilise.** |
| `current_status` | TEXT | Statut actuel |
| `assignee` | TEXT | |
| `priority` | TEXT | |
| `current_sprint_id` | INTEGER | Sprint actif courant uniquement |
| `original_estimate_seconds` | INTEGER | 1 jour Atlassian = 28 800 s |

## `transitions`

Historique complet des changements de statut. **Source de vérité pour toutes les métriques de durée et de débit.**

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `issue_key` | TEXT FK → issues | |
| `from_status` | TEXT | `NULL` à la création |
| `to_status` | TEXT | |
| `transitioned_at` | TEXT | ISO 8601 |

Index : `issue_key`, `to_status`, `transitioned_at`.

## `statuses`

Mapping statut → catégorie Atlassian. Populé par `sync` depuis `/rest/api/2/status`.

| Colonne | Type | Description |
|---|---|---|
| `name` | TEXT PK | Nom exact retourné par l'API |
| `category_key` | TEXT | `new` / `indeterminate` / `done` |
| `category_name` | TEXT | Nom localisé |

**Caveat** : `/rest/api/2/status` ne retourne que les statuts actifs. Les statuts historiques renommés présents dans `transitions` (ex: "To Be Validated", "Delivred") n'y apparaissent pas ; ils doivent rester dans `config.jira.doneStatuses`.

## `sprints`

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | ID Jira |
| `name` | TEXT | |
| `state` | TEXT | `active` / `closed` / `future` |
| `start_date` | TEXT | |
| `end_date` | TEXT | |
| `board_id` | INTEGER | |

## `sync_log`

| Colonne | Description |
|---|---|
| `synced_at` | Horodatage ISO |
| `issues_count` | Issues traitées |
| `project_key` | Clé projet |

## `issue_field_changes`

Historique des changements de champs métier par issue, extrait du changelog Jira. Populé à chaque sync (stratégie replace-all par issue, comme `transitions`).

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `issue_key` | TEXT FK → issues | |
| `field_name` | TEXT | Nom brut du champ Jira : `description`, `summary`, `Story Points`, `Sprint` |
| `from_value` | TEXT | Valeur précédente (`NULL` si première assignation) |
| `to_value` | TEXT | Nouvelle valeur (`NULL` si suppression du champ) |
| `changed_at` | TEXT | ISO 8601, horodatage de l'entrée changelog |

Index : `issue_key`, `field_name`, `changed_at`.

Champs surveillés définis dans `WATCHED_FIELDS` (constante module-level dans `src/sync.ts`) : `description`, `summary`, `Story Points`, `Sprint`. Tout autre champ est ignoré silencieusement.

## `issue_sprints`

Table de jonction représentant l'appartenance historique complète d'une issue à ses sprints. Peuplée depuis `customfield_10020` à chaque sync (stratégie replace-all par issue). Inclut les issues créées directement dans un sprint (sans entrée changelog Sprint dans `issue_field_changes`). Sert de dénominateur pour `scope-change-rate`.

| Colonne | Type | Description |
|---|---|---|
| `issue_key` | TEXT FK → issues | Clé de l'issue |
| `sprint_id` | INTEGER FK → sprints | Identifiant du sprint |

PK composite : `(issue_key, sprint_id)`. Index : `issue_key`, `sprint_id`.

## `metric_snapshots`

Long format : une ligne par `(date, métrique, bucket, stat)`.

| Colonne | Type | Description |
|---|---|---|
| `snapshot_date` | TEXT | Dimanche fin de semaine |
| `metric_name` | TEXT | Identifiant métrique |
| `bucket` | TEXT | XS/S/M/L/XL/BUG/UNESTIMATED, ou `''` |
| `stat` | TEXT | `median`, `p85`, `count`, `estimatedDays`, `aggregate`, `activeDays`, `queueDays`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p95` |
| `value` | REAL | |

PK composite : `(snapshot_date, metric_name, bucket, stat)`.
Index : `snapshot_date`, `metric_name`.

# Configuration (`config.yaml`)

[← Index](../spec-fonctionnelle.md)

```yaml
jira:
  baseUrl: "https://your-jira.atlassian.net"
  email: "user@example.com"
  apiToken: "xxx"
  projectKey: "KECK"
  boardId: 42
  name: "Ma Squad"                  # optionnel — affiché dans le titre du rapport

board:
  columns:
    - name: "À faire"
      type: todo
      statuses:
        - "To Do"

    - name: "Développement"
      type: active
      devStart: true              # cycle time démarre ici
      statuses:
        - "In Development"
      legacyStatuses:             # anciens noms renommés, conservés pour l'historique
        - "Dev in progress"

    - name: "Review"
      type: queue                 # queue time pour flow-efficiency
      statuses:
        - "In Review"
        - "Ready for QA"

    - name: "Done"
      type: done
      statuses:
        - "Done"

  legacyDoneStatuses:             # statuts done renommés absents de l'API Jira courante
    - "To Be Validated"

metrics:
  cutoffDate: "2024-01-01"        # Ignorer les issues livrées avant cette date
  bugIssueTypes:
    - "Bug"

db:
  path: "./jira.db"
```

## Rôle des colonnes et dérivation des statuts

Le board est défini comme une liste ordonnée de colonnes. Chaque colonne a un `type`, une liste de `statuses` (noms courants) et une liste optionnelle de `legacyStatuses` (anciens noms renommés). Le système dérive automatiquement les listes de statuts nécessaires aux métriques :

| `type` colonne | Liste dérivée | Rôle dans les métriques |
|---|---|---|
| `todo` | `todoStatuses` | Début du **lead time** |
| `active` + `devStart: true` | `devStartStatuses` | Début du **cycle time** |
| `active` ∪ `queue` | `inProgressStatuses` | Calcul du **WIP** courant et historique |
| `active` | `activeStatuses` | "Touch time" pour `flow-efficiency` |
| `queue` | `queueStatuses` | "Queue time" pour `flow-efficiency` |
| `done` ∪ `legacyDoneStatuses` | `doneStatuses` | Définit la **livraison équipe** (`done_at`) |

Pour chaque colonne, `legacyStatuses` alimente les mêmes listes dérivées que `statuses` : les anciens noms sont inclus dans les calculs de métriques pour couvrir l'historique des transitions.

`legacyDoneStatuses` (niveau board) : alternative pour les statuts done renommés ; convention recommandée pour les statuts de livraison, car elle est distincte des colonnes non-done.

| Paramètre | Rôle |
|---|---|
| `metrics.cutoffDate` | Borne basse globale : issues livrées avant sont ignorées. |
| `metrics.bugIssueTypes` | Bucket dédié BUG, exclu des métriques normalized/weighted. |

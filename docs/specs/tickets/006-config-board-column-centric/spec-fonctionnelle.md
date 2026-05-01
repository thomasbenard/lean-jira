# Spec fonctionnelle — Config board centré sur les colonnes

## Contexte

`config.yaml` expose cinq listes de statuts (`todoStatuses`, `devStartStatuses`,
`inProgressStatuses`, `activeStatuses`, `queueStatuses`). Ces listes se chevauchent :
un statut comme `"Développement en cours"` apparaît dans `devStartStatuses` ET
`inProgressStatuses` ET `activeStatuses`. Ajouter un nouveau statut = éditer 2-3 listes
manuellement. La structure ne reflète pas le modèle mental de l'utilisateur (colonnes du board).

## Comportement attendu

### Nouvelle structure `config.yaml`

L'utilisateur définit le board sous forme de colonnes ordonnées :

```yaml
board:
  columns:
    - name: "À faire"
      type: todo
      statuses:
        - "Prêt à faire"
        - "Ready to do"

    - name: "Développement"
      type: active
      devStart: true
      statuses:
        - "Développement en cours"
        - "Dev in progress"
        - "En attente"

    - name: "Review"
      type: queue
      statuses:
        - "À revoir"
        - "Reviewed"

    - name: "Done"
      type: done
      statuses:
        - "Livré"
        - "Done"

  legacyDoneStatuses:
    - "Delivred"
    - "DELIVERED"
    - "To Be Validated"
```

### Dérivation automatique des listes

À partir des colonnes, le système reconstitue :

| Liste dérivée      | Règle de dérivation                                                  |
|--------------------|----------------------------------------------------------------------|
| `todoStatuses`     | Statuts des colonnes `type: todo`                                    |
| `devStartStatuses` | Statuts des colonnes `devStart: true`                                |
| `inProgressStatuses` | Statuts des colonnes `type: active` ∪ `type: queue`               |
| `activeStatuses`   | Statuts des colonnes `type: active`                                  |
| `queueStatuses`    | Statuts des colonnes `type: queue`                                   |
| `doneStatuses`     | Statuts des colonnes `type: done` ∪ `legacyDoneStatuses`            |

### Comportement de `buildMetricConfig`

Inchangé côté sortie : reçoit les mêmes listes qu'avant, filtre les statuts `done` de
`inProgressStatuses`/`activeStatuses`/`queueStatuses` via `getDoneStatusNames(db)`. La dérivation
intervient en amont, dans `loadConfig` ou via une fonction dédiée.

## Cas limites

- Colonne `type: done` sans `legacyDoneStatuses` → `doneStatuses` = seuls les statuts de la colonne done (+ ceux de la DB Jira)
- Aucune colonne `devStart: true` → `devStartStatuses` = liste vide → métriques cycle-time retournent 0 issues (comportement actuel déjà identique)
- Colonne `devStart: true` avec `type: todo` ou `type: queue` → autorisé (pas d'hypothèse sur le type)
- Plusieurs colonnes `devStart: true` → les statuts de toutes sont unionés
- Statut présent dans plusieurs colonnes → union sans doublon (Set)

## Ce qui ne change pas

- `SyncConfig` dans `sync.ts` (utilise uniquement `baseUrl`, `email`, `apiToken`, `projectKey`, `boardId`)
- `buildMetricConfig` en sortie : même signature, même comportement
- `metrics.cutoffDate`, `metrics.bugIssueTypes`, `jira.*` credentials, `db.path`
- Toute la logique de filtrage done-set dans `buildMetricConfig`
- Compatibilité du format `config.yaml` avec `npm run sync` / `metrics` / `snapshots` / `report`

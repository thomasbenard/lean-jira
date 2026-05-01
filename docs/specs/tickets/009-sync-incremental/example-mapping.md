# Example Mapping — Sync incrémental

## Règle 1 — Détection du mode sync (premier vs incrémental)

**Si aucune entrée dans `sync_log`, le sync est complet. Si une entrée existe, seules les issues modifiées depuis sont récupérées.**

```gherkin
Scenario: premier sync — pas d'entrée dans sync_log
  Given la table sync_log est vide pour le projet "KECK"
  When sync() est appelé
  Then fetchAllIssues est appelé sans filtre updatedSince
  And la console affiche "Premier sync — récupération complète"

Scenario: sync suivant — entrée dans sync_log
  Given sync_log contient une entrée avec synced_at = "2026-04-01T07:00:00.000Z" pour "KECK"
  When sync() est appelé
  Then fetchAllIssues est appelé avec updatedSince = "2026-04-01T07:00:00.000Z"
  And la console affiche "Sync incrémental depuis 2026-04-01T07:00:00.000Z"
```

## Règle 2 — Conversion de la date pour le JQL Jira

**La date ISO stockée dans `sync_log` est convertie au format JQL `"YYYY-MM-DD HH:MM"` avant injection dans la requête.**

```gherkin
Scenario: conversion ISO vers format JQL
  Given updatedSince = "2026-04-01T07:30:45.000Z"
  When fetchAllIssues construit la requête
  Then le paramètre jql envoyé à l'API est `updated >= "2026-04-01 07:30"`

Scenario: absence de filtre si updatedSince absent
  Given updatedSince est undefined
  When fetchAllIssues construit la requête
  Then aucun paramètre jql n'est ajouté à la requête
```

## Règle 3 — Aucune issue modifiée

**Si Jira ne retourne aucune issue (tout est à jour), les upserts s'exécutent avec une liste vide sans erreur.**

```gherkin
Scenario: sync incrémental sans issue modifiée
  Given le dernier sync date d'il y a 10 minutes
  And aucune issue n'a été modifiée dans Jira depuis
  When sync() est appelé
  Then upsertIssues est appelé avec une liste vide
  And replaceAllTransitions est appelé avec une liste vide
  And logSync enregistre issues_count = 0
  And aucune erreur n'est levée
```

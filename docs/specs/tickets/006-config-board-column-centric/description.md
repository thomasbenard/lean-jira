# Ticket 006 — Config board centré sur les colonnes

## User story

En tant que lead technique configurant lean-jira sur un nouveau projet, je veux définir le board
Jira sous forme de colonnes avec leurs statuts et types, afin de n'avoir qu'un seul endroit à
éditer au lieu de dupliquer les noms de statuts dans cinq listes séparées.

## Solution retenue

Remplacer les cinq listes plates (`todoStatuses`, `devStartStatuses`, `inProgressStatuses`,
`activeStatuses`, `queueStatuses`) dans `config.yaml` par une section `board.columns` : tableau
de colonnes avec `name`, `type` (`todo` | `active` | `queue` | `done`), flag optionnel `devStart`,
et liste `statuses`. Une fonction `deriveStatusConfig()` dans `main.ts` reconstitue les listes
attendues par `buildMetricConfig`. Les statuts legacy done (`legacyDoneStatuses`) restent une
liste explicite séparée (statuts historiques renommés absents de l'API courante).

## Estimation

**Bucket** : S

**Justification** : 2 fichiers sources touchés (`config.yaml` + `src/main.ts`), 1 fichier test
créé. Logique de dérivation simple (mapping colonnes → listes par type). Pas de migration DB.
Pattern `Set` déjà présent dans `buildMetricConfig`. 4-6 scénarios de test attendus.

## Statut

**livré**

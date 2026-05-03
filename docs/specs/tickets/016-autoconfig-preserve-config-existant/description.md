# Ticket 016 — autoconfig : préserver le config existant

## User story

En tant que lead technique configurant lean-jira, je veux que `autoconfig --apply` préserve mes personnalisations (`legacyStatuses`, `devStart`, `type: queue`) lorsqu'un `config.yaml` existe déjà, afin de pouvoir relancer la commande après un renommage de colonne Jira sans perdre le travail de configuration manuelle.

## Solution retenue

Nouvelle fonction `mergeColumns(existing, inferred)` dans `src/main.ts` : quand `config.yaml` possède déjà `board.columns`, chaque colonne inférée depuis l'API est fusionnée avec son homologue existante (match par nom). La fusion préserve `type`, `devStart` et `legacyStatuses` de la config existante, et met à jour uniquement la liste `statuses` (noms courants depuis l'API). Les colonnes absentes de l'API mais présentes en config sont conservées avec un warning. Les nouvelles colonnes API absentes du config sont inférées par position et ajoutées avec un warning. `legacyDoneStatuses` est fusionné (union sans doublon) plutôt qu'écrasé.

## Estimation

**Bucket** : M (~1.5j)

**Justification** : 1 fichier touché (`src/main.ts`), nouvelle fonction `mergeColumns()` ~30 lignes, logique de merge par nom avec 3 cas (match / nouveau / supprimé). 6-7 scénarios de test. Pas de migration DB, pas de nouvel endpoint API.

## Statut

**livré**

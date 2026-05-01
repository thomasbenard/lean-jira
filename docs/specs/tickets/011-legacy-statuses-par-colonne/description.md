# Ticket 011 — `legacyStatuses` par colonne

## User story

En tant que développeur maintenant lean-jira sur un projet Jira ayant renommé ses statuts, je veux déclarer les anciens noms de statuts par colonne dans `config.yaml`, afin que `validate-config` les reconnaisse comme statuts historiques légitimes et ne les compte plus comme erreurs.

## Solution retenue

Ajouter un champ optionnel `legacyStatuses?: string[]` sur `BoardColumn` (en miroir de `legacyDoneStatuses` qui existe déjà au niveau board pour les statuts done). `deriveStatusConfig` inclut ces noms dans les listes dérivées (pour que les métriques fonctionnent sur l'historique des transitions). `validateStatusConfig` reçoit un `Set<string>` de noms legacy : les statuts absents de la DB mais présents dans ce set sont marqués `isLegacy = true` (affichés `✗ … (statut legacy)` mais non comptabilisés dans `missingCount`). La commande `validate-config` construit ce set depuis `config.board.columns[*].legacyStatuses`.

## Estimation

**Bucket** : S (~1j)

**Justification** : 1 fichier prod (`src/main.ts`, 4 points de modification), 2 fichiers test. Pattern direct : duplication du mécanisme `legacyDoneStatuses` vers les colonnes non-done. Pas de migration DB. 4 scénarios test.

## Statut

**à faire**

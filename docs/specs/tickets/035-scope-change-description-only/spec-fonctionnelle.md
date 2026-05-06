# Spec fonctionnelle — scope-change-rate : détection description uniquement

## Contexte

`scope-change-rate` détecte actuellement trois types de modifications post-sprint-start : changement significatif de description/summary (seuil Levenshtein 0.85), réévaluation Story Points (valeur → valeur), et reprogrammation sprint (sprint → sprint différent). Les deux derniers types génèrent du bruit : une réévaluation SP est une pratique agile normale qui ne reflète pas une instabilité de périmètre ; une reprogrammation de sprint est déjà visible dans d'autres métriques. Seul le changement de description/summary indique réellement un scope drift.

## Comportement attendu

### Déclencheur d'une "issue modifiée"

Une issue est comptée comme modifiée (`changedIssues++`) si et seulement si sa **description** ou son **summary** a changé significativement (similarité Levenshtein normalisée < 0.85) après le début de son premier sprint.

Les changements de Story Points et de sprint ne déclenchent plus le comptage.

### Tableau des issues modifiées (rapport HTML)

La colonne "Type" dans le tableau n'affiche plus que "Description". Les libellés "Story Points" et "Reprogrammé" disparaissent.

### `byChangeType`

`byChangeType` ne contient plus que `{ description: number }`. Les champs `storyPoints` et `sprintChange` sont supprimés de l'interface et du calcul.

### `ScopeChangedIssueDetail`

Ne contient plus que `{ key: string; description: boolean }`. Les champs `storyPoints` et `sprintChange` disparaissent.

## Cas limites

- Issue avec uniquement une réévaluation SP après sprint start → `changedIssues` non incrémenté (comportement inversé par rapport à l'actuel)
- Issue avec uniquement une reprogrammation sprint → `changedIssues` non incrémenté
- Issue avec changement description ET réévaluation SP → comptée une seule fois, type = description uniquement
- Issue sans aucun changement de description/summary → non détectée

## Ce qui ne change pas

- La logique `findFirstSprint` (utilise toujours les entrées `field_name='Sprint'` de `issue_field_changes`)
- Le dénominateur `totalIssues` (inchangé, issu de `issue_sprints`)
- La capture dans `issue_field_changes` au sync (`Story Points` et `Sprint` continuent d'être stockés)
- Le seuil de similarité 0.85 et les champs texte surveillés (`description`, `summary`)
- La description de la métrique dans `CLAUDE.md` et `metrics-formulas.md`

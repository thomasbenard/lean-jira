# Spec fonctionnelle — Corriger le dénominateur de scope-change-rate

## Contexte

La métrique `scope-change-rate` calcule un taux de dérive par sprint : `changedIssues / totalIssues`. Actuellement, `totalIssues` est dérivé des entrées `issue_field_changes.field_name = 'Sprint'` — seules les issues ayant un enregistrement de changement Sprint en base sont comptées.

Cela produit un dénominateur trop faible si :
- Des issues étaient dans le sprint avant la première synchronisation (pas de changelog capturé)
- Des issues ont été créées directement dans le sprint avec `from_value = null` mais sans entrée en base

Conséquence : un sprint avec 8 issues dont 1 modifiée peut afficher 100% de dérive si le changelog n'a capturé que cette 1 issue.

## Comportement attendu

### Dénominateur

`totalIssues` pour un sprint = nombre d'issues distinctes ayant appartenu à ce sprint, d'après la table `issue_sprints` peuplée lors du sync à partir de `customfield_10020`.

Les issues dont `issue_type IN board.excludeIssueTypes` sont exclues du dénominateur (comportement inchangé).

### Numérateur

`changedIssues` = issues dont un champ surveillé a changé **après** la date de début du premier sprint d'entrée — logique inchangée, source `issue_field_changes`.

### Attribution d'une issue à un sprint

Pour imputer un `changedIssue` à son sprint dans `bySprint`, on utilise le premier sprint par date de début parmi les sprints de `issue_sprints` (même logique que `findFirstSprint` actuelle, mais les sprints proviennent désormais de `issue_sprints` et non uniquement du changelog Sprint).

### Taux

`changeRatio = changedIssues / totalIssues` — identique, mais `totalIssues` est maintenant fiable.

## Cas limites

- **Base non migrée** (`issue_sprints` vide) : `totalIssues = 0` pour tous les sprints → `changeRatio = 0` → résultats vides. La métrique se comporte comme si aucune issue n'était trackée. Un `npm run sync` résout le problème.
- **Issue dans plusieurs sprints** (reprogrammée) : comptée une fois par sprint dans `issue_sprints`. `totalIssues` de chaque sprint l'inclut. Le `changedIssue` est imputé au premier sprint seulement.
- **Sprint sans `start_date`** : exclu du dénominateur comme actuellement.
- **Issue modifiée mais non dans `issue_sprints`** : ignorée pour `changedIssues` (son sprint d'entrée est inconnu).

## Ce qui ne change pas

- Logique de détection des modifications (`issue_field_changes`, Levenshtein, seuil 0.85)
- Champs surveillés (`description`, `summary`, `Story Points`, `Sprint`)
- Exclusion par `excludeIssueTypes`
- Format de sortie `ScopeChangeResult` (aucune interface publique modifiée)
- Section rapport HTML et tests du rapport

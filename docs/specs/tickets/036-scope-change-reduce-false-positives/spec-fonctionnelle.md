# Spec fonctionnelle — scope-change-rate : réduire les faux positifs

## Contexte

`scope-change-rate` détecte les changements de description/summary après entrée en sprint avec un seuil de similarité Levenshtein de 0.85. La comparaison est faite changement par changement (paires consécutives). En pratique, les enrichissements progressifs (ajouts de détails, reformatage Jira, nettoyage de whitespace en sprint planning) restent chacun sous le seuil mais représentent collectivement une dérive réelle — ou inversement, accumulent sans jamais la franchir alors que la dérive cumulée est significative. Le ticket SWNGF-7433 illustre le second cas : 3 modifications de description après sprint start, chacune à ~0.87-0.95 de similarité → non détectée malgré une dérive cumulée visible.

## Comportement attendu

### Règle 1 — Comparaison first vs last par champ

Pour chaque issue, pour chaque champ surveillé (`description`, `summary`) indépendamment :

- Identifier le premier changement du champ **après** la grace period (voir Règle 2)
- `firstValue` = `from_value` de ce premier changement (état au moment de l'entrée en sprint)
- `lastValue` = `to_value` du dernier changement du champ après la grace period
- Comparer `firstValue` vs `lastValue` via `similarityRatio`
- Si `similarityRatio < 0.85` → issue détectée

Les modifications intermédiaires ne sont plus évaluées. Si un seul changement existe après la grace period : `firstValue = from_value`, `lastValue = to_value` de ce changement (comportement identique à l'actuel pour ce cas).

### Règle 2 — Grace period

Les changements intervenant dans les `gracePeriodHours` heures suivant `firstSprintStart` sont ignorés dans la détection (non comptabilisés comme post-sprint). Valeur par défaut : 0 (aucune grace period, comportement identique à l'actuel).

Configuration : `board.yaml` → `metrics.scopeChangeGracePeriodHours: 24`.

### Règle 3 — Strip macros Jira dans `normalizeText`

La fonction `normalizeText` supprime, avant toute autre transformation :
- Macros Jira : `{macroName}` et `{macroName:param=val|…}` → espace
- Images : `!nom.ext!` et `!nom.ext|thumbnail!` → espace
- Liens Jira : `[texte|URL]` → `texte` (le texte du lien est conservé, l'URL supprimée)

Ces suppressions s'appliquent avant le `toLowerCase` et le collapse `\s+` existants. Un changement qui ne modifie que la macro encapsulant du contenu inchangé produit un `similarityRatio = 1.0` → non détecté.

### Règle 4 — Additions pures ignorées

Après normalisation, si `levenshtein(a, b) === len(b) − len(a)` **et** `len(b) > len(a)` : aucune substitution ni suppression, uniquement des insertions. La fonction retourne `1.0` (pas de dérive).

Les suppressions pures (`len(a) > len(b)`) **ne sont pas** exemptées : retirer des exigences est une dérive de périmètre.

### Règle 5 — Whitespace guard (implicite)

Si après normalisation complète (macros + whitespace collapse) les deux textes sont identiques, `levenshtein = 0`, `similarityRatio = 1.0` → non détecté. Aucun code supplémentaire nécessaire ; découle des Règles 1 et 3.

## Cas limites

- Issue avec 1 seul changement description après sprint start : `firstValue = from_value`, `lastValue = to_value` → comportement inchangé par rapport à l'actuel (hors normalisation améliorée)
- Issue avec changements description ET summary : chaque champ évalué indépendamment ; suffit qu'un seul franchisse le seuil pour que l'issue soit détectée
- `firstSprintStart` tombant exactement à la même seconde qu'un changement : ce changement est exclu (`changed_at <= graceCutoff`, opérateur `<=` strict)
- Grace period > durée totale des changements : aucun changement retenu → `firstValue = null` → non détecté
- Texte vide avant ou après (suppression complète) : `similarityRatio(text, "") < 0.85` pour tout texte non vide → détecté (suppression totale = dérive)
- Macro Jira dans lien `[texte|https://…]` : l'URL est supprimée, le texte conservé → un changement d'URL seule n'est plus détecté
- `from_value = null` : ignoré (changement initial sans valeur précédente, comportement inchangé)

## Ce qui ne change pas

- Le seuil de similarité 0.85
- `findFirstSprint` et la logique d'attribution sprint
- `issue_sprints` comme dénominateur (`totalIssues`)
- La capture dans `issue_field_changes` au sync
- Les interfaces `ScopeChangeResult`, `SprintScopeStats`, `ScopeChangedIssueDetail`
- Le rapport HTML (aucun changement visible côté affichage)
- `CLAUDE.md` et `metrics-formulas.md` (comportement de surface inchangé, affinement interne)

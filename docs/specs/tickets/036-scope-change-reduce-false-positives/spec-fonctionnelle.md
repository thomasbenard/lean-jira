# Spec fonctionnelle — scope-change-rate : réduire les faux positifs

## Contexte

`scope-change-rate` détecte les changements de description/summary après entrée en sprint avec un seuil de similarité Levenshtein de 0.85. La comparaison est faite changement par changement (paires consécutives). En pratique, les enrichissements progressifs (ajouts de détails, reformatage Jira, nettoyage de whitespace en sprint planning) restent chacun sous le seuil mais représentent collectivement une dérive réelle — ou inversement, accumulent sans jamais la franchir alors que la dérive cumulée est significative. Le ticket SWNGF-7433 illustre le second cas : 3 modifications de description après sprint start, chacune à ~0.87-0.95 de similarité → non détectée malgré une dérive cumulée visible.

## Comportement attendu

### Règle 1 — Comparaison first vs last par champ, depuis le premier devStart

Pour chaque issue, pour chaque champ surveillé (`description`, `summary`) indépendamment :

- `firstDevStart` = première transition vers un statut `devStartStatuses` dans la table `transitions`
- Si aucune transition devStart trouvée → issue **exclue de la détection** (reste dans `totalIssues`)
- Identifier le premier changement du champ **après** `firstDevStart` (+ grace period, voir Règle 2)
- `firstValue` = `from_value` de ce premier changement post-devStart
- `lastValue` = `to_value` du dernier changement du champ post-devStart
- Comparer `firstValue` vs `lastValue` via `similarityRatio`
- Si `similarityRatio < 0.85` → issue détectée

Les modifications intermédiaires ne sont plus évaluées. Si un seul changement post-devStart existe : `firstValue = from_value`, `lastValue = to_value` de ce changement.

**Rôle de `firstSprintName`** : l'attribution sprint (clé de `bySprint`) reste basée sur le premier sprint de l'issue via `findFirstSprint` / `issue_sprints` — inchangé.

### Règle 2 — Grace period

Les changements intervenant dans les `gracePeriodHours` heures suivant `firstDevStart` sont ignorés dans la détection. Valeur par défaut : 0 (aucune grace period).

Configuration : `board.yaml` → `metrics.scopeChangeGracePeriodHours: 24`.

### Règle 3 — Strip macros Jira dans `normalizeText`

La fonction `normalizeText` supprime, avant toute autre transformation :
- Macros Jira : `{macroName}` et `{macroName:param=val|…}` → espace
- Images : `!nom.ext!` et `!nom.ext|thumbnail!` → espace
- Liens Jira : `[texte|URL]` → `texte` (le texte du lien est conservé, l'URL supprimée)

Ces suppressions s'appliquent avant le `toLowerCase` et le collapse `\s+` existants. Un changement qui ne modifie que la macro encapsulant du contenu inchangé produit un `similarityRatio = 1.0` → non détecté.

### Règle 4 — Dénominateur = longueur du texte original

`similarityRatio` mesure la dérive **par rapport au texte d'origine** :

```
sim = max(0, 1 − levenshtein(a, b) / len(a))
```

où `a = normalizeText(from)`, `b = normalizeText(to)`.

Conséquences :
- Ajout de N% de contenu → sim = `1 − N%`. Détecté si N > ~15 % (seuil 0.85).
- Suppression partielle ou totale → dist élevé relatif à `len(a)` → sim proche de 0 → toujours détecté.
- Réécriture complète → dist ≈ max(len(a), len(b)) → sim ≤ 0 → clampé à 0 → détecté.

Le `pure-addition guard` binaire (cas spécial `dist === len(b) − len(a)`) est supprimé. Les petits appends (< 15 % de l'original) passent naturellement sous le seuil sans traitement spécial.

### Règle 5 — Whitespace guard (implicite)

Si après normalisation complète (macros + whitespace collapse) les deux textes sont identiques, `levenshtein = 0`, `similarityRatio = 1.0` → non détecté. Aucun code supplémentaire nécessaire ; découle des Règles 1 et 3.

## Cas limites

- Issue sans transition devStart (jamais démarrée) : exclue de la détection, reste dans `totalIssues`
- Issue avec 1 seul changement description après devStart : `firstValue = from_value`, `lastValue = to_value` → comportement simple
- Issue avec changements description ET summary : chaque champ évalué indépendamment ; suffit qu'un seul franchisse le seuil pour que l'issue soit détectée
- Changements de description antérieurs à `firstDevStart` : ignorés (y compris les rewrites faits pendant la préparation backlog avant que le dev commence)
- `firstDevStart` tombant exactement à la même seconde qu'un changement : ce changement est exclu (`changed_at <= graceCutoff`, opérateur `<=` strict)
- Grace period > durée totale des changements post-devStart : aucun changement retenu → non détecté
- Texte vide avant ou après (suppression complète) : `similarityRatio(text, "") < 0.85` pour tout texte non vide → détecté (suppression totale = dérive)
- Macro Jira dans lien `[texte|https://…]` : l'URL est supprimée, le texte conservé → un changement d'URL seule n'est plus détecté
- `from_value = null` : ignoré (changement initial sans valeur précédente)

## Ce qui ne change pas

- Le seuil de similarité 0.85
- `findFirstSprint` et la logique d'attribution sprint
- `issue_sprints` comme dénominateur (`totalIssues`)
- La capture dans `issue_field_changes` au sync
- Les interfaces `ScopeChangeResult`, `SprintScopeStats`, `ScopeChangedIssueDetail`
- Le rapport HTML (aucun changement visible côté affichage)
- `CLAUDE.md` et `metrics-formulas.md` (comportement de surface inchangé, affinement interne)

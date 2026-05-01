# Example Mapping — Inférence active/queue par mots-clés

## Règle 1 — Match de mot-clé → type queue avec commentaire

**Si le nom d'une colonne intermédiaire contient un mot-clé de la liste, le type est `queue` et le mot-clé apparaît dans un commentaire inline.**

```gherkin
Scenario: colonne "Code Review" → queue
  Given une colonne intermédiaire nommée "Code Review"
  When inferBoardColumns() est appelé
  Then la colonne a type: "queue"
  And queueKeyword vaut "review"
  And le YAML contient '# inféré depuis le mot-clé "review" — vérifier'

Scenario: match insensible à la casse
  Given une colonne intermédiaire nommée "VALIDATION CLIENT"
  When inferBoardColumns() est appelé
  Then la colonne a type: "queue"
  And queueKeyword vaut "validation"

Scenario: pas de mot-clé → type active inchangé
  Given une colonne intermédiaire nommée "Développement"
  When inferBoardColumns() est appelé
  Then la colonne a type: "active"
  And queueKeyword est undefined
  And le YAML contient '# changer en "queue" si temps d\'attente'
```

---

## Règle 2 — devStart: true sur la première colonne active (après mots-clés)

**Si la première colonne intermédiaire est inférée queue, devStart passe sur la suivante colonne active.**

```gherkin
Scenario: première colonne intermédiaire est queue
  Given un board [todo, "Review", "Développement", done]
  When inferBoardColumns() est appelé
  Then "Review" a type: "queue" et pas de devStart
  And "Développement" a type: "active" et devStart: true

Scenario: toutes colonnes intermédiaires sont queue
  Given un board [todo, "Review", "Validation", done]
  When inferBoardColumns() est appelé
  Then aucune colonne n'a devStart: true
  And un avertissement est affiché sur stderr
```

---

## Règle 3 — Plusieurs mots-clés dans le nom

**Un seul commentaire, premier match utilisé.**

```gherkin
Scenario: nom contenant deux mots-clés
  Given une colonne intermédiaire nommée "QA Review"
  When inferBoardColumns() est appelé
  Then la colonne a type: "queue"
  And queueKeyword vaut "review"  # premier match dans QUEUE_KEYWORDS
  And un seul commentaire est affiché
```

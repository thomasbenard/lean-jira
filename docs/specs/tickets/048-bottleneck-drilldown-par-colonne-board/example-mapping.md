# Example Mapping — Bottleneck drill-down par colonne board

## Règle 1 — Agrégation multi-statuts par colonne

**Plusieurs statuts dans la même colonne sont poolés avant calcul de la médiane.**

```gherkin
Scenario: deux statuts dans la même colonne board
  Given board.yaml définit une colonne "Dev" avec statuts ["In Progress", "Code Review"]
  And un ticket a passé 2j en "In Progress" et 3j en "Code Review"
  And un autre ticket a passé 1j en "In Progress" et 4j en "Code Review"
  When bottleneck-analysis est calculé
  Then byColumn contient une entrée { column: "Dev", role: "dev", medianDays: 2.5 }
  And byColumn ne contient pas d'entrée séparée pour "In Progress" ou "Code Review"

Scenario: chaque statut dans sa propre colonne board
  Given board.yaml définit "In Progress" dans colonne "Dev" et "Code Review" dans colonne "Review"
  And un ticket a passé 2j en "In Progress" et 3j en "Code Review"
  When bottleneck-analysis est calculé
  Then byColumn contient { column: "Dev", medianDays: 2.0 } et { column: "Review", medianDays: 3.0 }
```

## Règle 2 — Fallback statut orphelin

**Un statut sans correspondance board utilise son propre nom.**

```gherkin
Scenario: statut Jira absent de board.yaml
  Given board.yaml ne contient pas le statut "Legacy QA"
  And un ticket a passé 5j en "Legacy QA"
  And "Legacy QA" est dans qaStatuses (venant d'un legacyStatuses sur une colonne QA)
  When bottleneck-analysis est calculé
  Then byColumn contient { column: "Legacy QA", role: "qa" }

Scenario: statut dans legacyStatuses d'une colonne
  Given board.yaml définit colonne "QA" avec legacyStatuses: ["Legacy QA"]
  And un ticket a passé 5j en "Legacy QA"
  When bottleneck-analysis est calculé
  Then byColumn contient { column: "QA", role: "qa" }
```

## Règle 3 — dominantColumn = colonne, pas statut

**dominantColumn dans RoleBottleneckScore reflète la colonne board la plus lente.**

```gherkin
Scenario: dominantColumn pointe vers la colonne la plus lente du rôle
  Given byColumn pour dev = [{ column: "Code Review", medianDays: 4 }, { column: "In Progress", medianDays: 2 }]
  When bottleneck-analysis est calculé
  Then byRole.dev.dominantColumn = "Code Review"
  And primaryColumn = "Code Review" (si dev est le primaryBottleneck)
```

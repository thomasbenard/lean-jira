# Example Mapping — Bottleneck analysis drill-down colonne

## Règle 1 — Identification de la colonne dominante

**La colonne dominante d'un rôle est le statut avec le temps médian le plus élevé parmi les statuts de ce rôle.**

```gherkin
Scenario: colonne la plus lente identifiée dans dev
  Given un board avec devStatuses = ["In Progress", "Code Review"]
  And 2 issues livrées :
    | issue | In Progress | Code Review |
    | P-1   | 7j          | 1j          |
    | P-2   | 5j          | 2j          |
  When on calcule bottleneck-analysis
  Then byRole.dev.dominantColumn = "In Progress"
  And byRole.dev.signals.stageTimeMedianDays est la somme (6j = médiane des 12j/7j)

Scenario: rôle avec une seule colonne
  Given devStatuses = ["In Progress"] seulement
  And 1 issue livrée avec 5j en "In Progress"
  When on calcule bottleneck-analysis
  Then byRole.dev.dominantColumn = "In Progress"
```

## Règle 2 — Colonne absente des transitions

**Si aucune issue livrée ne passe par un statut du rôle, dominantColumn vaut null.**

```gherkin
Scenario: rôle po sans aucune transition vers ses statuts
  Given poStatuses = ["Validation PO"]
  And 2 issues livrées qui ne passent jamais par "Validation PO"
  When on calcule bottleneck-analysis
  Then byRole.po.dominantColumn = null

Scenario: rôle po avec au moins une transition
  Given poStatuses = ["Validation PO"]
  And 1 issue livrée qui passe par "Validation PO" pendant 3j
  When on calcule bottleneck-analysis
  Then byRole.po.dominantColumn = "Validation PO"
```

## Règle 3 — primaryColumn et tiebreak

**primaryColumn = dominantColumn du rôle identifié comme primaryBottleneck. Tiebreak alphabétique en cas d'égalité de médiane.**

```gherkin
Scenario: primaryColumn reflète le rôle primaire
  Given dev est le primaryBottleneck
  And byRole.dev.dominantColumn = "In Progress"
  Then result.primaryColumn = "In Progress"

Scenario: tiebreak alphabétique entre deux colonnes à médiane égale
  Given devStatuses = ["Code Review", "In Progress"]
  And médiane "Code Review" = 3j, médiane "In Progress" = 3j
  When on calcule bottleneck-analysis
  Then byRole.dev.dominantColumn = "Code Review"
```

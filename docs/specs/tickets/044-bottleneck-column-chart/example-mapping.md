# Example Mapping — Bottleneck column chart

## Règle 1 — Contenu et tri de byColumn

**Les colonnes sont triées par rôle (dev → qa → po), puis par médiane décroissante au sein de chaque rôle. Tiebreak alphabétique.**

```gherkin
Scenario: deux colonnes dev, la plus lente en premier
  Given une issue livrée avec transitions
    | statut      | entrée       | sortie       |
    | In Progress | 2025-01-08   | 2025-01-15   |  (5j ouvrés)
    | Code Review | 2025-01-15   | 2025-01-16   |  (1j ouvré)
  And config devStatuses: ["In Progress", "Code Review"], qaStatuses: ["In Review"]
  When compute() est appelé
  Then byColumn[0] = { status: "In Progress", role: "dev", medianDays: 5, count: 1 }
  And  byColumn[1] = { status: "Code Review", role: "dev", medianDays: 1, count: 1 }
  And  byColumn[2] = { status: "In Review",   role: "qa",  medianDays: ?, count: 1 }

Scenario: tiebreak alphabétique sur médiane identique
  Given deux colonnes dev avec même médiane
  Then la colonne alphabétiquement antérieure est en premier dans son groupe
```

## Règle 2 — count = nombre d'issues ayant traversé la colonne

**count = longueur du tableau `columnDays[status]`, i.e. nombre de passages (issues livrées ayant transitionné vers ce statut).**

```gherkin
Scenario: deux issues passent par In Progress
  Given deux issues livrées passant toutes les deux par "In Progress"
  When compute() est appelé
  Then byColumn pour "In Progress" a count = 2

Scenario: colonne jamais traversée
  Given config avec poStatuses: ["Validation PO"]
  And aucune issue ne passe par "Validation PO"
  Then "Validation PO" est absent de byColumn
```

## Règle 3 — État vide

**Si count = 0 ou aucun rôle configuré → byColumn = [].**

```gherkin
Scenario: aucune issue livrée
  Given aucune transition vers un statut done
  When compute() est appelé
  Then byColumn est vide

Scenario: aucun rôle configuré
  Given devStatuses: [], qaStatuses: [], poStatuses: []
  When compute() est appelé
  Then byColumn est vide (via emptyResult())
```

## Règle 4 — Rendu HTML

**`buildColumnDrilldownHtml()` retourne chaîne vide si byColumn est vide. Sinon rend un panel avec une barre par colonne.**

```gherkin
Scenario: panel affiché avec données
  Given byColumn = [{ status: "In Progress", role: "dev", medianDays: 5, count: 20 }]
  When buildColumnDrilldownHtml() est appelé
  Then le HTML contient "In Progress"
  And  contient "5.0j"
  And  contient "(20)"
  And  la barre est à 100% (seule colonne = max)

Scenario: panel absent si byColumn vide
  Given byColumn = []
  When buildColumnDrilldownHtml() est appelé
  Then retourne ""
```

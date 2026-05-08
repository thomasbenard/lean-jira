# Example Mapping — Bucketize par méthode d'estimation

## Règle 1 — Story-points / numeric → bucket selon seuils

**`bucketize()` utilise `story_points` avec `resolveThresholds()` pour story-points et numeric.**

```gherkin
Scenario: Issue 5 SP, seuils par défaut story-points
  Given EstimationConfig { method: "story-points" }   # xs=1, s=3, m=8, l=13
  And issue avec story_points = 5
  When bucketize() est appelée
  Then bucket = "M"

Scenario: Issue 0 SP (non estimée)
  Given EstimationConfig { method: "story-points" }
  And issue avec story_points = 0
  When bucketize() est appelée
  Then bucket = "UNESTIMATED"

Scenario: Complexity points avec seuils custom
  Given EstimationConfig { method: "numeric", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } }
  And issue avec story_points = 3   # colonne partagée avec story-points
  When bucketize() est appelée
  Then bucket = "S"   # [2, 5)

Scenario: Bug avec story_points renseigné
  Given EstimationConfig { method: "story-points" }
  And issue avec story_points = 8, isBug = true
  When bucketize() est appelée
  Then bucket = "BUG"   # règle bug prime
```

## Règle 2 — T-shirt → mapping direct du label

**Pas de seuils pour t-shirt : le label est directement le bucket.**

```gherkin
Scenario: Label valide "M"
  Given EstimationConfig { method: "t-shirt" }
  And issue avec size_label = "M"
  When bucketize() est appelée
  Then bucket = "M"

Scenario: Label null (non estimé)
  Given EstimationConfig { method: "t-shirt" }
  And issue avec size_label = NULL
  When bucketize() est appelée
  Then bucket = "UNESTIMATED"
```

## Règle 3 — Time → seuils en jours après conversion secondes

**`original_estimate_seconds` est divisé par SECONDS_PER_DAY avant comparaison.**

```gherkin
Scenario: Issue estimée 2j (57600s), seuils par défaut
  Given EstimationConfig { method: "time" }   # xs=0.5, s=1, m=3, l=5
  And issue avec original_estimate_seconds = 57600   # = 2j
  When bucketize() est appelée
  Then bucket = "M"   # [1j, 3j)

Scenario: Seuils time custom
  Given EstimationConfig { method: "time", bucketThresholds: { xs: 1, s: 2, m: 5, l: 10 } }
  And issue avec original_estimate_seconds = 28800   # = 1j
  When bucketize() est appelée
  Then bucket = "S"   # [1j, 2j)
```

## Règle 4 — None → toujours UNESTIMATED sauf bugs

```gherkin
Scenario: Feature en mode none
  Given EstimationConfig { method: "none" }
  And issue avec original_estimate_seconds = 28800, isBug = false
  When bucketize() est appelée
  Then bucket = "UNESTIMATED"   # estimation ignorée

Scenario: Bug en mode none
  Given EstimationConfig { method: "none" }
  And isBug = true
  When bucketize() est appelée
  Then bucket = "BUG"
```

## Règle 5 — getBucketLabels() adapte les labels à la méthode

```gherkin
Scenario: Labels story-points avec seuils par défaut
  Given EstimationConfig { method: "story-points" }
  When getBucketLabels() est appelée
  Then labels["XS"] = "XS (<1 SP)"
  And  labels["M"]  = "M (3-8 SP)"

Scenario: Labels numeric sans unité
  Given EstimationConfig { method: "numeric", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } }
  When getBucketLabels() est appelée
  Then labels["XS"] = "XS (<2)"
  And  labels["M"]  = "M (5-10)"   # pas d'unité — dépend du champ custom

Scenario: Labels time (inchangés)
  Given EstimationConfig { method: "time" }
  When getBucketLabels() est appelée
  Then labels["XS"] = "XS (<0.5j)"
```

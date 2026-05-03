# Example Mapping — KPIs : signaux de santé statiques

## Règle 1 — evalLowerBetter : vert/orange/rouge/none

**Pour une métrique où une valeur plus basse est meilleure, le signal dépend du seuil configuré.**

```gherkin
Scenario: valeur dans la zone saine
  Given threshold = { warn: 5, crit: 10 }
  When value = 3
  Then signal = "green"

Scenario: valeur en zone orange
  Given threshold = { warn: 5, crit: 10 }
  When value = 7
  Then signal = "orange"

Scenario: valeur en zone rouge
  Given threshold = { warn: 5, crit: 10 }
  When value = 12
  Then signal = "red"

Scenario: valeur exactement au seuil warn → vert (inclusif)
  Given threshold = { warn: 5, crit: 10 }
  When value = 5
  Then signal = "green"

Scenario: seuil absent → aucun signal
  Given threshold = undefined
  When value = 12
  Then signal = "none"

Scenario: valeur null → aucun signal même si seuil présent
  Given threshold = { warn: 5, crit: 10 }
  When value = null
  Then signal = "none"
```

---

## Règle 2 — evalHigherBetter : throughput inversé

**Pour le throughput, une valeur plus haute est meilleure — la logique est inversée.**

```gherkin
Scenario: throughput élevé → vert
  Given threshold = { warn: 3, crit: 1 }
  When value = 5
  Then signal = "green"

Scenario: throughput faible → orange
  Given threshold = { warn: 3, crit: 1 }
  When value = 2
  Then signal = "orange"

Scenario: throughput nul → rouge
  Given threshold = { warn: 3, crit: 1 }
  When value = 0
  Then signal = "red"

Scenario: valeur exactement au seuil warn → vert (inclusif)
  Given threshold = { warn: 3, crit: 1 }
  When value = 3
  Then signal = "green"
```

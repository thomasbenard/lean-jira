# Example Mapping — KPIs : seuils dynamiques configurables

## Règle 1 — Mode statique : comportement inchangé

**Si `mode` est absent ou vaut `"static"`, les ThresholdPair configurés sont utilisés tels quels.**

```gherkin
Scenario: mode static explicite avec seuils configurés
  Given board.yaml contient healthThresholds.mode: "static"
  And   healthThresholds.cycleTimeMedianDays: { warn: 10, crit: 20 }
  And   la valeur courante de cycle-time médiane est 15 jours
  When  le rapport est généré
  Then  le signal cycle-time est "orange"

Scenario: mode absent (rétrocompatibilité)
  Given board.yaml contient healthThresholds sans champ mode
  And   healthThresholds.cycleTimeMedianDays: { warn: 10, crit: 20 }
  And   la valeur courante est 8 jours
  When  le rapport est généré
  Then  le signal cycle-time est "green"
```

---

## Règle 2 — Mode dynamique : seuils calculés depuis l'historique

**En mode `dynamic`, warn = P50 et crit = P85 (lower-better) ou P15 (higher-better) sur la fenêtre glissante.**

```gherkin
Scenario: signal vert — valeur sous la médiane historique
  Given board.yaml contient healthThresholds.mode: "dynamic", windowWeeks: 12
  And   les 12 dernières semaines ont des médianes cycle-time [8,9,10,11,12,10,9,8,10,11,12,9]
  And   P50 = 10, P85 = 12
  And   la valeur courante de cycle-time médiane est 8 jours
  When  le rapport est généré
  Then  le signal cycle-time est "green"

Scenario: signal rouge — valeur au-delà du P85 historique
  Given board.yaml contient healthThresholds.mode: "dynamic", windowWeeks: 12
  And   P50 = 10, P85 = 12 (mêmes données)
  And   la valeur courante de cycle-time médiane est 15 jours
  When  le rapport est généré
  Then  le signal cycle-time est "red"

Scenario: throughput (higher-better) — valeur sous le P15 historique
  Given board.yaml contient healthThresholds.mode: "dynamic"
  And   les 12 dernières semaines ont des throughputs [2,3,4,5,3,4,5,6,3,4,5,4]
  And   P15 = 2, P50 = 4
  And   la valeur courante de throughput est 1
  When  le rapport est généré
  Then  le signal throughput est "red"
```

---

## Règle 3 — Fenêtre insuffisante → signal none

**Si moins de 4 semaines de données disponibles pour un KPI dans la fenêtre, le signal est "none".**

```gherkin
Scenario: DB vide ou données trop récentes
  Given board.yaml contient healthThresholds.mode: "dynamic", windowWeeks: 12
  And   la table metric_snapshots contient 2 semaines de données seulement
  When  le rapport est généré
  Then  tous les signaux KPI dynamiques sont "none" (tuiles sans couleur)
```

---

## Règle 4 — Override statique en mode dynamic

**Un ThresholdPair explicite dans board.yaml prend le dessus sur le seuil dynamique pour ce KPI uniquement.**

```gherkin
Scenario: throughput override en mode dynamic
  Given board.yaml contient healthThresholds.mode: "dynamic"
  And   healthThresholds.throughputWeekly: { warn: 3, crit: 1 }
  And   le seuil dynamique calculé pour throughput serait { warn: 4, crit: 2 }
  And   la valeur courante de throughput est 2
  When  le rapport est généré
  Then  le signal throughput est "orange"  # basé sur override statique { warn:3, crit:1 }
  And   les autres KPIs utilisent les seuils dynamiques
```

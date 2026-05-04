# Example Mapping — Rapport : métriques role-aware

## Règle 1 — Affichage conditionnel selon disponibilité des snapshots

**Si une métrique n'a aucun snapshot, son graphique n'est pas rendu (pas d'erreur JS).**

```gherkin
Scenario: métrique 022 non encore implémentée, pas de snapshot wip-per-role
  Given metric_snapshots ne contient aucune ligne avec metric_name = "wip-per-role"
  When le rapport est généré
  Then le canvas "wipPerRoleChart" est présent dans le HTML
  And la fonction lineChart reçoit une ChartSeries avec dates = []
  And aucune exception JS n'est levée

Scenario: stage-time-breakdown implémenté, snapshots présents
  Given metric_snapshots contient des lignes stage-time-breakdown avec buckets dev/qa/po
  When le rapport est généré
  Then les KPI "Médiane dev", "Médiane qa", "Médiane po" affichent des valeurs numériques
  And le canvas "stageTimeByRoleChart" est rendu avec des données
```

---

## Règle 2 — Discriminateur `extractStats` : `avgShareByRole` vs `byRole`

**`stage-time-breakdown` est détecté par `avgShareByRole`, `wip-per-role` par `byRole` seul.**

```gherkin
Scenario: résultat StageTimeSummary → branche avgShareByRole
  Given un résultat avec champs { count, byRole: { dev: DurationStats, ... }, avgShareByRole: { dev, qa, po } }
  When extractStats est appelé
  Then des lignes avec stat = "median", "p85", "avgShare" sont produites par bucket dev/qa/po
  And aucune ligne avec stat = "count" seul par bucket n'est produite

Scenario: résultat WipPerRoleResult → branche byRole
  Given un résultat avec champs { byRole: { dev: { count, issueKeys }, qa: ..., po: ... } }
  And le résultat ne contient pas avgShareByRole
  When extractStats est appelé
  Then des lignes avec stat = "count" sont produites par bucket dev, qa, po
  And aucune ligne avec stat = "median" n'est produite
```

---

## Règle 3 — `buildRoleSeries` combine plusieurs buckets en une ChartSeries

**La fonction aligne les dates de tous les buckets et retourne zéro si une date manque pour un rôle.**

```gherkin
Scenario: 3 rôles avec dates alignées
  Given des snapshots stage-time-breakdown avec bucket dev/qa/po et stat "median" à la même date
  When buildRoleSeries(rows, ["dev","qa","po"], "median") est appelé
  Then la ChartSeries retournée a dates = [cette date]
  And series.dev, series.qa, series.po contiennent chacun une valeur

Scenario: un rôle manque pour une date donnée
  Given des snapshots avec bucket "dev" à la date D et bucket "qa" absent à la date D
  When buildRoleSeries(rows, ["dev","qa","po"], "median") est appelé
  Then series.qa[index de D] = 0
  And aucune exception n'est levée
```

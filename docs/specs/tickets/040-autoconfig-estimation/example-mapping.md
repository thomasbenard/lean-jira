# Example Mapping — Autoconfig détection de la méthode d'estimation

## Règle 1 — Mapping `fieldId` → `EstimationConfig`

**Le champ `estimation.field.fieldId` de l'API board config détermine la méthode.**

```gherkin
Scenario: Board configuré avec time estimate
  Given boardConfig.estimation = { type: "field", field: { fieldId: "timeoriginalestimate" } }
  When inferEstimationConfig(boardConfig)
  Then résultat = { method: "time" }

Scenario: Board configuré avec Story Points Atlassian
  Given boardConfig.estimation = { type: "field", field: { fieldId: "customfield_10016", displayName: "Story Points" } }
  When inferEstimationConfig(boardConfig)
  Then résultat = { method: "story-points" }

Scenario: Board configuré avec champ custom inconnu
  Given boardConfig.estimation = { type: "field", field: { fieldId: "customfield_10099", displayName: "Complexity" } }
  When inferEstimationConfig(boardConfig)
  Then résultat = { method: "numeric", jiraField: "customfield_10099" }

Scenario: Board sans estimation (type: none)
  Given boardConfig.estimation = { type: "none" }
  When inferEstimationConfig(boardConfig)
  Then résultat = { method: "none" }

Scenario: Board Scrum en mode issueCount
  Given boardConfig.estimation = { type: "issueCount" }
  When inferEstimationConfig(boardConfig)
  Then résultat = { method: "none" }

Scenario: API ancienne — champ estimation absent
  Given boardConfig sans champ estimation
  When inferEstimationConfig(boardConfig)
  Then résultat = { method: "time" }
```

## Règle 2 — Warning pour champ custom non-standard

**Un champ inconnu émet un warning invitant à vérifier si la méthode est t-shirt.**

```gherkin
Scenario: Champ custom détecté → warning émis
  Given boardConfig.estimation = { type: "field", field: { fieldId: "customfield_10200", displayName: "T-Shirt Size" } }
  When autoconfig s'exécute
  Then warnings contient un message mentionnant "customfield_10200"
  And  le message mentionne "t-shirt"

Scenario: Story Points standard → aucun warning
  Given boardConfig.estimation = { type: "field", field: { fieldId: "customfield_10016" } }
  When autoconfig s'exécute
  Then warnings ne contient aucun message sur l'estimation
```

## Règle 3 — Préservation de l'estimation existante en mode --apply

**Si board.yaml contient déjà `metrics.estimation`, il n'est jamais écrasé.**

```gherkin
Scenario: board.yaml sans estimation existante
  Given board.yaml existant sans bloc metrics.estimation
  And   boardConfig.estimation = { type: "field", field: { fieldId: "customfield_10016" } }
  When  autoconfig --apply
  Then  board.yaml résultant contient estimation: { method: "story-points" }

Scenario: board.yaml avec estimation déjà configurée
  Given board.yaml existant avec metrics.estimation: { method: "t-shirt", jiraField: "customfield_10200" }
  And   boardConfig.estimation = { type: "field", field: { fieldId: "customfield_10200" } }
  When  autoconfig --apply
  Then  board.yaml résultant contient estimation: { method: "t-shirt", jiraField: "customfield_10200" }
  And   l'estimation détectée (numeric) est ignorée
```

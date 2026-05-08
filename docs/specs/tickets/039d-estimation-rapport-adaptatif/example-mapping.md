# Example Mapping — Rapport adaptatif selon méthode d'estimation

## Règle 1 — Sections masquées selon méthode

**`none` masque toutes les sections estimation-dépendantes. `t-shirt` masque throughput pondéré et normalisés.**

```gherkin
Scenario: Rapport en mode "none"
  Given EstimationConfig { method: "none" }
  When le rapport HTML est généré
  Then "Throughput pondéré" a style="display:none"
  And  "Lead normalisé" a style="display:none"
  And  "Cycle normalisé" a style="display:none"
  And  "Lead by-size" a style="display:none"
  And  "Cycle by-size" a style="display:none"
  And  "Lead time" (non estimation-dépendant) est visible

Scenario: Rapport en mode "t-shirt"
  Given EstimationConfig { method: "t-shirt", jiraField: "customfield_10200" }
  When le rapport HTML est généré
  Then "Throughput pondéré" a style="display:none"
  And  "Lead normalisé" a style="display:none"
  And  "Lead by-size" est visible
  And  "Cycle by-size" est visible

Scenario: Rapport en mode "time" (défaut)
  Given EstimationConfig { method: "time" }
  When le rapport HTML est généré
  Then toutes les sections estimation-dépendantes sont visibles
  And  titre throughput contient "j-h estimés"
  And  aucun message contextuel sur les normalisés
```

## Règle 2 — Message contextuel sur normalisés pour story-points/numeric

**Quand `showNormalizedNote = true`, un message invite à préférer les métriques flow.**

```gherkin
Scenario: Normalisés en mode time (seul cas où visibles + message)
  Given EstimationConfig { method: "time" }
  When le rapport HTML est généré
  Then "Lead normalisé" est visible
  And  la section contient le message "ratio basé sur les estimations"
  And  le message contient "métriques de flux (lead time, cycle time) sont plus fiables"

Scenario: Normalisés en mode story-points (masqués — disabled: true retourné par métrique)
  Given EstimationConfig { method: "story-points" }
  When le rapport HTML est généré
  Then "Lead normalisé" a style="display:none"
  And  "Cycle normalisé" a style="display:none"

Scenario: Normalisés en mode numeric (masqués)
  Given EstimationConfig { method: "numeric" }
  When le rapport HTML est généré
  Then "Lead normalisé" a style="display:none"
```

## Règle 3 — Labels et unités adaptés

**Titres, bucket selectors et unités reflètent la méthode configurée.**

```gherkin
Scenario: Throughput pondéré en mode story-points
  Given EstimationConfig { method: "story-points" }
  When le rapport HTML est généré
  Then titre throughput = "Throughput pondéré (SP estimés)"
  And  bucket selector lead-by-size contient "XS (<1 SP)", "M (3-8 SP)"

Scenario: Throughput pondéré en mode numeric
  Given EstimationConfig { method: "numeric", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } }
  When le rapport HTML est généré
  Then titre throughput = "Throughput pondéré (pts estimés)"
  And  bucket selector contient "XS (<2)", "M (5-10)"

Scenario: By-size en mode t-shirt
  Given EstimationConfig { method: "t-shirt" }
  When le rapport HTML est généré
  Then bucket selector contient "XS", "S", "M", "L", "XL" sans unité
```

## Règle 4 — Bandeau de contexte toujours présent

```gherkin
Scenario: Bandeau mode "none"
  Given EstimationConfig { method: "none" }
  When le rapport HTML est généré
  Then bandeau = "Estimation : aucune — métriques by-size désactivées"

Scenario: Bandeau mode "story-points" seuils par défaut
  Given EstimationConfig { method: "story-points" }
  When le rapport HTML est généré
  Then bandeau contient "Estimation : story points (SP) — seuils XS<1 S<3 M<8 L<13"

Scenario: Bandeau mode "numeric"
  Given EstimationConfig { method: "numeric", jiraField: "customfield_10099" }
  When le rapport HTML est généré
  Then bandeau = "Estimation : champ custom (pts)"
```

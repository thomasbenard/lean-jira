# Example Mapping — Bottleneck Analysis

## Règle 1 — Ranking relatif entre rôles

**Le score est un rang normalisé 0–1 entre les 3 rôles sur chaque signal, pas un seuil absolu.**

```gherkin
Scenario: dev accumule le plus de travail
  Given 3 rôles configurés (dev, qa, po)
  And avgNetFlow = { dev: +3.2, qa: +0.5, po: -1.0 }
  When on normalise par ranking
  Then rankNetFlow = { dev: 1.0, qa: 0.5, po: 0.0 }

Scenario: tous les rôles ont le même net flow
  Given avgNetFlow = { dev: 0.0, qa: 0.0, po: 0.0 }
  When on normalise par ranking
  Then rankNetFlow = { dev: 0.0, qa: 0.0, po: 0.0 }
  # égalité parfaite → contribue 0 au score composite pour tous
```

---

## Règle 2 — Signal dominant et seuil "combined"

**Si l'écart entre le signal dominant et le deuxième est < 0.1, le signal est "combined".**

```gherkin
Scenario: un signal domine clairement
  Given rôle qa avec rankStageTime=0.8, rankNetFlow=0.3, rankRework=0.2, rankFtr=0.1
  When on détermine le dominantSignal
  Then dominantSignal = "stage_time"
  # écart 0.8 - 0.3 = 0.5 ≥ 0.1

Scenario: deux signaux quasi-égaux
  Given rôle qa avec rankStageTime=0.7, rankNetFlow=0.65, rankRework=0.2, rankFtr=0.1
  When on détermine le dominantSignal
  Then dominantSignal = "combined"
  # écart 0.7 - 0.65 = 0.05 < 0.1

Scenario: égalité exacte avec priorité TOC
  Given rôle dev avec rankNetFlow=0.9, rankStageTime=0.9, rankRework=0.4, rankFtr=0.2
  When on détermine le dominantSignal
  Then dominantSignal = "accumulation"
  # ex-æquo → priorité accumulation > stage_time
```

---

## Règle 3 — Cas dégénérés

**Population vide ou rôles non configurés → métrique muette mais non crashante.**

```gherkin
Scenario: aucune issue livrée dans la fenêtre
  Given count = 0
  When on calcule bottleneck-analysis
  Then primaryBottleneck = null
  And recommendation = ""
  And byRole.dev.score = 0, byRole.qa.score = 0, byRole.po.score = 0

Scenario: aucun rôle configuré dans board.yaml
  Given devStatuses = [], qaStatuses = [], poStatuses = []
  When on calcule bottleneck-analysis
  Then un warning est loggué
  And primaryBottleneck = null
```

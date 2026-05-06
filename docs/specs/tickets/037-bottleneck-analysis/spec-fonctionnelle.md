# Spec fonctionnelle — Bottleneck Analysis

## Contexte

L'équipe dispose déjà de métriques rôle-aware (stage-time-breakdown, stage-throughput-gap,
handoff-rework, first-time-right) mais aucune ne synthétise les signaux pour désigner un
stage prioritaire. Le lead tech doit actuellement croiser manuellement quatre tableaux pour
identifier où agir. `bottleneck-analysis` automatise cette synthèse.

## Comportement attendu

### Score composite par rôle

Pour chaque rôle (dev, qa, po), quatre signaux sont calculés sur la population cycle-time
(fenêtre 30j en snapshot, complète en CLI) :

| Signal | Mesure | Direction |
|--------|--------|-----------|
| `stageTimeMedianDays` | Temps médian passé dans ce rôle | Plus élevé = plus mauvais |
| `avgNetFlow` | Moyenne hebdomadaire de (entrées − sorties) au rôle | Positif = accumulation = mauvais |
| `reworkInboundRate` | % tickets revenus dans ce rôle après en être sortis | Plus élevé = plus mauvais |
| `ftrPenalty` | `1 − ftrRate` du rôle (inverse du first-time-right) | Plus élevé = plus mauvais |

Chaque signal est normalisé par **ranking relatif** entre les 3 rôles :
- Rang 0 = meilleur des 3 rôles sur ce signal
- Rang 0.5 = médian
- Rang 1 = pire des 3 rôles

Le score composite = moyenne des 4 rangs normalisés ∈ [0, 1].

### Dominant signal

Pour chaque rôle, le signal dont le rang normalisé est le plus élevé devient le
`dominantSignal`. En cas d'ex-æquo, priorité : `accumulation` > `stage_time` > `rework` >
`ftr` (ordre TOC : queue avant durée, durée avant qualité).

### Ranking et recommandation

Les rôles sont classés du score le plus élevé (pire bottleneck) au plus faible. Le rôle de
rang 1 est le `primaryBottleneck`. Une recommandation actionnable est générée selon le
`dominantSignal` du `primaryBottleneck` :

| dominantSignal | Recommandation |
|----------------|----------------|
| `accumulation` | "Réduire les entrées en {role} ou augmenter la capacité disponible à ce stage." |
| `stage_time` | "Décomposer les tâches avant {role} pour réduire le temps de passage unitaire." |
| `rework` | "Améliorer les critères d'entrée en {role} (Definition of Ready) pour éviter les retours." |
| `ftr` | "Renforcer les critères de sortie de {role} (Definition of Done) pour éviter les rejets." |
| `combined` | "Plusieurs signaux convergent sur {role} — analyser la charge et la qualité simultanément." |

`combined` est utilisé quand aucun signal ne domine clairement (tous les rangs à ±0.1 du score
composite).

### Rôles non configurés

Si `board.yaml` ne définit aucun `role:` sur ses colonnes, la métrique retourne
`primaryBottleneck: null`, scores = 0, et log un warning identique à `stage-time-breakdown`.

Si seulement 1 ou 2 rôles sont configurés, le scoring se fait sur les rôles disponibles
uniquement ; les rôles manquants ont score = 0 et rank = dernier.

### Population

Même population que `stage-time-breakdown` et `handoff-rework` : issues livrées (transition
vers `doneStatuses`) dans la fenêtre temporelle configurée, sans les types exclus.

## Cas limites

- Population vide (aucune issue livrée dans la fenêtre) → `count: 0`, `primaryBottleneck: null`, tous scores = 0.
- Un seul rôle configuré → score = 0 (pas de ranking possible entre rôles), warning log.
- Tous rôles ex-æquo sur tous signaux → `dominantSignal: "combined"`, ranking arbitraire mais stable (ordre alphabétique dev < po < qa).
- `avgNetFlow` négatif pour tous les rôles (pipeline fluide) → le rôle le moins négatif a rang 1 sur ce signal.
- Rôle sans aucun passage dans la population (ex: po non utilisé) → tous ses signaux = 0, score = 0, rank = dernier.

## Section rapport HTML

### Panneau de diagnostic courant

Calculé live (appel direct à `bottleneckAnalysisMetric.compute`) comme `agingWip` et `forecast`.
Affiché en haut de la section role-aware, avant les graphes :

```
┌─────────────────────────────────────────────────────┐
│ 🔴 Bottleneck détecté : QA                          │
│ Signal dominant : accumulation                      │
│ Recommandation : Réduire les entrées en qa ou       │
│ augmenter la capacité disponible à ce stage.        │
│                                                     │
│  dev  ██░░░░  0.31    qa  ████████  0.78   po  ░░  │
└─────────────────────────────────────────────────────┘
```

Couleur du badge : rouge si score ≥ 0.6, orange si 0.4–0.6, vert si < 0.4.
Si `primaryBottleneck === null` (rôles non configurés) : panneau masqué.

### Graphe d'évolution des scores

Depuis les snapshots `bottleneck-analysis`, stat `score` par bucket (dev/qa/po).
Graphe linéaire, axe Y 0–1, 3 courbes colorées (dev=bleu, qa=orange, po=violet).
Permet de voir si le bottleneck se déplace dans le temps.

## Ce qui ne change pas

- Aucune modification du schéma DB.
- Les 5 métriques sources (`stage-time-breakdown`, `stage-throughput-gap`, `handoff-rework`,
  `first-time-right`, `wip-per-role`) restent indépendantes — `bottleneck-analysis` recalcule
  depuis la DB plutôt que de les appeler, pour éviter le couplage.
- `scope-change-rate` et `forecast` non touchés.

# Spec fonctionnelle — First-Time-Right Rate

## Contexte

`handoff-rework` mesure les reworks en valeur absolue. `first-time-right` en donne la
lecture % par rôle — plus lisible en retro et comme KPI de santé. "80% des tickets
traversent QA une seule fois" est plus actionnable que "12 occurrences qa→dev".

## Comportement attendu

### Définition d'un passage

Un passage dans rôle R = une séquence contiguë de transitions vers des statuts R. Exemple :
```
dev → qa → qa_review → dev
```
→ 1 passage dev (1er bloc), 1 passage qa (bloc qa+qa_review), 1 passage dev (2ème bloc).
→ dev : 2 passages. qa : 1 passage.

Seuls les tickets qui ont au moins 1 passage dans ce rôle contribuent au calcul FTR de ce
rôle. Tickets sans passage dans un rôle sont exclus du dénominateur de ce rôle.

### FTR par rôle

```
FTR(rôle R) = count(tickets avec exactement 1 passage dans R)
              ─────────────────────────────────────────────────
              count(tickets avec au moins 1 passage dans R)
```

### Sortie CLI

```
=== FIRST-TIME-RIGHT ===
  Issues analysées : 45

  Rôle   FTR    Tickets 1 passage  Tickets ≥2 passages  Avg passages
  dev    91 %   41 / 45            4                    1.09
  qa     78 %   32 / 41            9                    1.24
  po     95 %   19 / 20            1                    1.05
```

### Population

Identique à `cycle-time` et `stage-time-breakdown` (tickets livrés, devStart + todo).
Filtres `cutoffDate`, `windowEndDate`, `excludeIssueTypes`, outliers cycle-time appliqués.

## Cas limites

- Ticket qui ne passe jamais par QA → exclu du dénominateur FTR QA (pas 0 passage = FTR parfait)
- Rôle PO non configuré → `poStatuses = []` → FTR PO absent du résultat (ou 0/0 → N/A)
- Ticket 1 seul passage dev, 0 qa, 0 po → contribue au FTR dev, pas aux autres
- Passage via statut `none` entre deux blocs du même rôle → deux passages distincts (coupure réelle)

## Ce qui ne change pas

- `handoff-rework` (024) inchangé — les deux métriques coexistent, complémentaires
- Population cycle-time inchangée

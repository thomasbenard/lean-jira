# Ticket 024 — Handoff Rework Detection

## User story

En tant que lead technique pilotant la qualité du process, je veux savoir quelle proportion
de nos tickets retournent en arrière entre rôles (ex: qa → dev), afin de mesurer objectivement
le coût du rework et d'identifier si la qualité en entrée de QA se dégrade.

## Solution retenue

Nouvelle métrique `handoff-rework`. Sur la population cycle-time (tickets livrés), utilise
`fetchDeliveredTransitions()` + `groupByIssue()` du ticket 020 pour reconstituer la séquence
de rôles par ticket. Un "rework" = transition de rôle qui revient vers un rôle antérieur dans
l'ordre naturel `dev → qa → po`. Compte par ticket : nombre total de reworks, par rôle source
(qaToDev, poToQa, poDev). Agrège en `avgReworks`, `reworkRatio` (% tickets avec ≥ 1 rework),
`byReworkType`. Snapshot 30-day rolling.

## Estimation

**Bucket** : M

**Justification** : 1 nouveau fichier avec analyse séquentielle des transitions (pattern
similaire à 023), 2 fichiers modifiés (`index.ts`, `compute.ts`). 5–7 scénarios test
(0 rework, 1 rework, multiple, rôle absent).

## Statut

**livré**

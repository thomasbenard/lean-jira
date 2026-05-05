# Ticket 026 — Rapport : métriques role-aware

## User story

En tant que lead technique, je veux visualiser les métriques role-aware (stage-time-breakdown, wip-per-role, stage-throughput-gap, handoff-rework, first-time-right) dans le rapport HTML, afin d'identifier d'où vient le goulot dans le flux dev → qa → po sans avoir à lancer `npm run metrics` en CLI.

## Solution retenue

Deux extensions en parallèle :

1. **`src/snapshots/compute.ts`** — 4 nouvelles branches dans `extractStats` pour les shapes des tickets 022–025 (`WipPerRoleResult`, `StageThroughputGapResult`, `HandoffReworkResult`, `FirstTimeRightResult`). Le ticket 021 (`stage-time-breakdown`) est déjà snapshotté via la branche `byRole` existante, mais son discriminateur est trop large (`"byRole" in result`) ; il est resserré en `"avgShareByRole" in result` pour ne pas capturer la shape 022.

2. **`src/report/generate.ts`** — Nouvelle section HTML "Flux par rôle" avec KPI cards et graphiques Chart.js pour les 5 métriques. Chaque métrique a un type de visualisation adapté à sa shape :
   - `stage-time-breakdown` : barres groupées médiane/P85 par rôle + courbe de tendance
   - `wip-per-role` : courbe WIP par rôle
   - `stage-throughput-gap` : barres net (in − out) par rôle
   - `handoff-rework` : courbe reworkRatio + barres par type (qaToDev / poToQa / poDev)
   - `first-time-right` : courbe FTR rate par rôle

Une fonction helper `buildRoleSeries(rows, buckets, stat)` est ajoutée dans `generate.ts` pour combiner plusieurs bucket-series en un seul `ChartSeries` multi-clés.

**Dépend des tickets 022, 023, 024, 025 livrés.**

## Estimation

**Bucket** : L

**Justification** : 2 fichiers impactés avec extensions substantielles — 4 nouvelles branches `extractStats` + refactor discriminateur (~50 lignes dans `compute.ts`) ; nouvelle section HTML avec 5 types de graphes différents, helper `buildRoleSeries`, HELP_TEXTS (~250 lignes dans `generate.ts`). ~8–10 scénarios de test.

## Statut

**livré**

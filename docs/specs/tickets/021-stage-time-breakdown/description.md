# Ticket 021 — Stage Time Breakdown

## User story

En tant que lead technique analysant les bottlenecks du process, je veux voir combien de
jours ouvrés nos tickets passent en moyenne dans chaque rôle (dev, qa, po), afin d'identifier
où le lead time est systématiquement consommé et de cibler les améliorations process.

## Solution retenue

Nouvelle métrique `stage-time-breakdown` implémentant `Metric<StageTimeSummary>`. Pour
chaque ticket de la population cycle-time (devStart + todo existence check), utilise
`fetchDeliveredTransitions()` + `groupByIssue()` + `computeRoleDays()` du ticket 020 pour
calculer `{devDays, qaDays, poDays}`. Agrège en `DurationStats` par rôle via
`statsFromDays()`. Calcule la part moyenne de cycle time par rôle (`avgShare`). Retourne
`{count, byRole: {dev, qa, po}, avgShareByRole: {dev, qa, po}}`. Snapshot 30-day rolling,
branch dédiée dans `extractStats`. Retour vide si aucun rôle configuré dans `MetricConfig`.

## Estimation

**Bucket** : M

**Justification** : 3 fichiers touchés (`src/metrics/stageTimeBreakdown.ts` nouveau,
`src/metrics/index.ts`, `src/snapshots/compute.ts`). Dépend de 019 + 020. Pattern calqué
sur `cycleTime.ts` + `flowEfficiency.ts`. 6–8 scénarios de test (rôle absent, ticket hors
population, multiple passes, proportions).

## Statut

**livré**

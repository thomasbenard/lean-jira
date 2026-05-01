# Ticket 007 — Courbe de tendance sur les graphes du rapport

## User story

En tant que lead technique ou PO, je veux voir une courbe de tendance superposée à chaque graphe de tendance hebdomadaire, afin d'identifier d'un coup d'œil si une métrique s'améliore, se dégrade ou reste stable sur la période.

## Solution retenue

Ajouter une fonction `computeMovingAvg(values, window=4)` en JS pur dans le bloc `<script>` du rapport HTML généré. Cette fonction calcule une moyenne mobile sur les 4 dernières semaines à chaque position (les 3 premiers points retournent `null`, skippés automatiquement par Chart.js). Préféré à la régression linéaire OLS pour trois raisons : robuste aux outliers isolés, n'impose pas de linéarité sur des données qui évoluent par sauts, et non faussé par les zéros de remplacement de `buildSeries`. La courbe est injectée comme dataset Chart.js supplémentaire (dashed, semi-transparent, sans fill) sur la série principale de chaque graphe line. La fonction `lineChart()` accepte un paramètre optionnel `withTrend` ; les graphes by-size (`initBucketSelector` → `renderChart`) reçoivent le même traitement. Aucun changement côté TypeScript, DB, ni snapshots.

## Estimation

**Bucket** : S

**Justification** : 1 seul fichier touché (`src/report/generate.ts`), modification limitée au bloc `<script>` embarqué dans la template string. Pattern pure JS, régression OLS triviale, pas de migration DB. 2-4 scénarios visuels, non unitarisables en l'état.

## Statut

**à faire**

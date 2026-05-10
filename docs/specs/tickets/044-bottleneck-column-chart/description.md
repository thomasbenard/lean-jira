# Ticket 044 — Bottleneck column chart

## User story

En tant que lead technique, je veux voir un graphe de drill-down par colonne Jira dans l'onglet Rôles, afin d'identifier quelle colonne précise (ex. "In Progress" vs "Code Review") est le goulot au sein d'un rôle.

## Solution retenue

Ajouter un champ `byColumn: ColumnStat[]` dans `BottleneckAnalysisResult` (calculé depuis `columnDays` déjà présent dans `compute()`). Chaque entrée porte le statut Jira, le rôle, la médiane de jours et le nombre d'issues ayant traversé. Dans `generate.ts`, ajouter une fonction `buildColumnDrilldownHtml()` produisant un panel HTML pur (même pattern `.bn-bars` / `.bn-row`) avec barres horizontales proportionnelles à la médiane, annotation du nombre d'issues, et couleur selon le rôle (--violet / --green / --orange). Le panel est placé immédiatement après le panel existant "Bottleneck Analysis" dans l'onglet Rôles.

## Estimation

**Bucket** : M

**Justification** : 2 fichiers source touchés (`bottleneckAnalysis.ts`, `generate.ts`), 3 fichiers de test à mettre à jour, pattern existant (`.bn-bars`) à dupliquer. Complexité algorithmique faible — données disponibles dans `columnDays`. 5-6 scénarios de test.

## Statut

**livré**

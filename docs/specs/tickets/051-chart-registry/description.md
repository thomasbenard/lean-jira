# Ticket 051 — Chart registry

## User story

En tant que développeur maintenant le rapport lean-jira, je veux que la correspondance métrique → graphique soit déclarée dans une configuration TypeScript centralisée, afin d'ajouter ou modifier un graphique sans toucher à la fois `generate.ts` et `report.hbs`.

## Solution retenue

Créer `src/report/chartDefs.ts` qui déclare un tableau `CHART_DEFS: ChartDef[]` — une entrée par canvas du rapport. Chaque `ChartDef` porte : l'id du canvas, la clé dans `CHARTS`, l'onglet, la clé i18n du titre, les données à collecter (`DataMode`), le type de graphe (`ChartType`), et les séries (`SeriesDef[]`). Côté serveur, `generate.ts` remplace l'objet `charts` hardcodé (23 appels `buildSeries`/`buildRoleSeries`) par `buildAllChartData(byMetric, CHART_DEFS)`. Côté template, `report.hbs` reçoit `chartDefsJson` via triple-stache et itère `CHART_DEFS` dans un dispatcher loop au lieu de ~30 appels individuels. Les renderers custom (histogramme, aging scatter, dual-axis…) deviennent des fonctions nommées enregistrées dans `CUSTOM_RENDERERS`. Le toggle Semaines/Sprints est réécrit en `initGlobalSprintToggle` qui s'appuie sur `sprintKey` dans les defs.

## Estimation

**Bucket** : L

**Justification** : 6 fichiers touchés (nouveau `chartDefs.ts` + `generate.ts` + `report.hbs` + `context.schema.json` + 2 fichiers de test). La partie la plus lourde est `report.hbs` : convertir ~30 appels hardcodés + 9 IIFEs custom + `initDebitToggle` en dispatcher. Pattern existant dans `generate.ts` (`buildSeries`/`buildRoleSeries`) simplifie `buildAllChartData`. Une dizaine de scénarios de test attendus.

## Statut

**livré**

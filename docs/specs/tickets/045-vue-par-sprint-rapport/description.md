# Ticket 045 — Vue par sprint dans le rapport

## User story

En tant que lead technique, je veux pouvoir basculer l'affichage des métriques de débit (throughput, bug-throughput, throughput-weighted) entre une vue semaines fixes et une vue par sprint réel, afin de comparer la cadence de livraison dans un référentiel aligné sur les itérations de l'équipe.

## Solution retenue

Dans `generate.ts`, calculer live les métriques de débit pour chaque sprint terminé (et le sprint actif s'il existe) en appelant `metric.compute(db, cfg)` avec `cutoffDate = sprint.start_date` et `windowEndDate = sprint.end_date`. Injecter les séries résultantes dans `RenderInput` sous `sprintCharts`. Dans le template `report.hbs`, ajouter un toggle bouton `Semaines / Sprints` au-dessus des 3 graphes concernés : au clic, le JS swaps les datasets Chart.js entre la série weekly (issue des snapshots) et la série sprint (injectée en JSON). Aucun changement à `metric_snapshots`, `db/store.ts` ou à la logique de snapshot.

## Estimation

**Bucket** : M

**Justification** : 2 fichiers src (`generate.ts`, `report.hbs`) + 1 fichier test. Pattern de compute déjà éprouvé dans `snapshots/compute.ts`. Complexité principale = toggle JS dans le template Handlebars + gestion sprint en cours (valeur partielle). ~5-7 scénarios test.

## Statut

**à faire**

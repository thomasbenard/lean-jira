# Ticket 015 — KPIs : signaux de santé statiques

## User story

En tant que lead technique, je veux que chaque KPI du rapport affiche un indicateur
vert/orange/rouge basé sur des seuils que je configure, afin de détecter en un coup d'œil
si une métrique s'est dégradée sans avoir à lire les graphes.

## Solution retenue

Ajout d'une section optionnelle `metrics.healthThresholds` dans `config.yaml` avec des
paires `{ warn, crit }` par KPI. Si un seuil est absent, aucun signal n'est affiché (dégradé
gracieux). La logique d'évaluation (`evalLowerBetter` / `evalHigherBetter`) et le CSS de
signal (point coloré sur la card KPI) vivent dans `src/report/generate.ts`. Les seuils sont
passés comme paramètre séparé à `generateReport()` — pas de pollution de `MetricConfig`
(les seuils sont un concern UI, pas métrique). Les defaults proposés sont fournis dans
`config.example.yaml` avec commentaires explicatifs.

## Estimation

**Bucket** : S

**Justification** : 2 fichiers TS touchés (`main.ts` interface + appel, `generate.ts` types +
helpers + CSS + 6 KPI cards), 2 fichiers config. Logique pure comparaisons. Pas de SQL, pas
de migration DB. ~5 scénarios TDD sur `evalLowerBetter` / `evalHigherBetter`.

## Statut

**livré**

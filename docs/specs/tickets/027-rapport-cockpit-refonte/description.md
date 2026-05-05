# Ticket 027 — Refonte rapport HTML vers design Cockpit

## User story

En tant que lead technique de l'équipe SWNGF, je veux ouvrir le rapport hebdomadaire et obtenir en moins de 5 secondes (a) un verdict global de l'état du flux, (b) la liste des 2-3 actions prioritaires à mener, (c) les KPI clés avec leur tendance 4 semaines, afin de transformer le rapport d'un dashboard exploratoire en un outil opérationnel de pilotage hebdo lundi matin.

## Solution retenue

Refonte de `src/report/generate.ts#renderHtml` selon le design **Cockpit** prototypé dans `report-a.html` :

- **Bandeau verdict** en haut : statut global (alerte / vigilance / sain) calculé depuis les seuils health, phrase de synthèse listant les 2-3 problèmes dominants.
- **Bloc Top-3 actions** : 3 cartes auto-générées depuis `agingWipMetric.compute()` — les 3 issues `risk: "critical"` les plus anciennes, avec lien Jira et statut.
- **Grille KPIs 4×2** : 8 cellules denses chacune avec libellé, gros chiffre, sparkline 12 semaines, delta « ▲/▼ X% / 4 sem » coloré selon `lowerIsBetter`/`higherIsBetter`. Métriques retenues : lead median, cycle median, throughput, WIP, bug ratio, bug cycle, FTR dev, critical aging count.
- **Tabs sectionnels** : `Livraison` (lead, cycle, throughput, throughput pondéré, distribution histogramme, by-size) · `Qualité & bugs` (bug throughput, bug cycle, allocation features/bugs, bug backlog) · `Flux par rôle` (cartes dev/qa/po + stage time, WIP par rôle, throughput net, FTR, rework) · `Forecast & aging` (table forecast, aging scatter, top items table) · `Avancé` (lead/cycle normalized, flow efficiency).
- **Aesthetic terminal sombre** : IBM Plex Mono + IBM Plex Sans via Google Fonts CDN, palette cyan/orange/rouge/ambre/vert sur fond `#08090c` avec grid pattern.

**Fonctionnalités existantes conservées** :

1. Tooltips d'aide `?` (helpers `helpBtn(key)` + classes `.help-wrap/.help-btn/.help-popover`) — repositionnés visuellement mais comportement identique.
2. Zoom modal sur graphiques (IIFE `initZoom` + classes `.zoom-btn`, `.chart-modal-overlay`, `.chart-modal*`) — conservé tel quel, attache zoom-btn à chaque `.chart-card`.
3. Tooltips Chart.js sur survol (`plugins.tooltip` activé par défaut, `interaction.mode: "index"` sur charts dual-axis) — conservé sur chaque `new Chart()`.

Le toggle clair/sombre (`themeToggle` + `localStorage.lean-theme`) est supprimé puisque le design Cockpit est exclusivement dark.

L'API publique de `generateReport()` et `renderHtml()` ne change pas : seul le contenu de la string HTML retournée est refondu. Les helpers `buildSeries`, `buildBucketSeries`, `buildRoleSeries`, `latestBySize`, `pickValue`, `buildHistogram` restent inchangés.

## Estimation

**Bucket** : L (3-5j)

**Justification** : Un seul fichier de prod touché (`src/report/generate.ts`, ~1330 lignes), mais ~70% du contenu de `renderHtml` est refondu (CSS complet + structure HTML + plusieurs scripts inline). Pas de migration DB, pas de nouvelle métrique. Risques techniques : (a) régression silencieuse des tooltips `?` ou du zoom modal si les sélecteurs CSS changent, (b) calcul des deltas 4 sem côté serveur (nouveau) ou côté JS (à trancher), (c) sparklines = nouveau code Chart.js (8 instances supplémentaires). Tests à ajuster : ~3-5 assertions HTML dans `tests/report/generate.test.ts` (sélecteurs `agingRowsHtml`, structure KPI). Scénarios test attendus : 8-10 (rendu verdict 3 cas, top-3 calcul, sparklines présentes, tabs switching, tooltip toujours présent, zoom modal toujours fonctionnel).

## Statut

**livré**

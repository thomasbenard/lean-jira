# Spec fonctionnelle — Rapport Cockpit

## Contexte

Le rapport HTML actuel (`npm run report`) est un dashboard exploratoire : 4 sections H2, 13 KPIs, 14+ graphiques sur une seule page longue, sans hiérarchie visuelle ni narration. Le ticket 014 (groupement) et 015 (signaux santé) ont déjà amélioré la lisibilité, mais l'équipe doit encore lire 30+ chiffres avant de savoir quoi faire en priorité. Les métriques actionnables (issues critical aging, bottleneck role) sont noyées dans des tables ou des courbes décoratives. Le prototype `report-a.html` à la racine du repo valide une refonte structurelle (verdict + actions + tabs) qui ramène la prise de décision sous 5 secondes.

## Comportement attendu

### Bandeau verdict (en haut, sticky non requis)

Une seule zone visible avant tout scroll. Affiche :

- **Statut** : un de `⚠ ALERTE` (rouge), `◐ VIGILANCE` (ambre), `✓ SAIN` (vert).
  - `⚠ ALERTE` si ≥1 KPI a un signal `red` calculé via `evalLowerBetter`/`evalHigherBetter` sur les `healthThresholds` configurés.
  - `◐ VIGILANCE` si aucun `red` mais ≥1 `orange`.
  - `✓ SAIN` si tous les signaux sont `green` ou `none`.
- **Phrase de synthèse** : énumère 2-4 KPI dégradés en clair. Format : `« Lead time {leadMedian}j au-dessus seuil critique. WIP {wipCount} tickets, {criticalCount} critical. Bug ratio {bugRatio}% persiste > 50%. »`. Si statut sain, phrase positive : `« Tous les indicateurs dans la zone verte. »`.
- **Métadonnée à droite** : `« Dernier sync {syncDate} · Snapshot {lastSnapshotDate} »`.

Le bandeau a une bordure latérale gauche colorée selon le statut.

### Bloc Top-3 actions

Sous le bandeau verdict. Trois cartes en grille horizontale (1×3 sur desktop, 1×1 stacking en mobile).

- Source : `agingWipMetric.compute(db, config).issues` filtré sur `risk === "critical"`, trié par `ageDays` décroissant, limité à 3.
- Si moins de 3 critical, compléter avec les `at-risk` les plus anciens.
- Si aucun aging critical/at-risk, afficher une seule carte verte : `« ✓ Aucun ticket en zone critique. »`
- Chaque carte affiche : numéro `// 01/02/03`, titre `Débloquer <issueKey>` (avec lien vers Jira), détail `<status> · âge <ageDays>j > P95 (<percentileP95>j)`.
- Bordure latérale rouge pour critical, ambre pour at-risk, verte pour le cas vide.

### Grille KPI 4×2

8 cellules en grille fixe. Chaque cellule :

- **Libellé** en haut, petit, dot de santé devant (signal calculé par `evalLowerBetter` ou `evalHigherBetter`).
- **Gros chiffre** + unité (suffixe `j`, `%`, `iss` ou rien).
- **Delta vs 4 sem** : `▲/▼ {pct}% 4w` coloré rouge ou vert selon que la variation est mauvaise ou bonne pour le KPI (lower-is-better → ↑ = rouge ; higher-is-better → ↑ = vert). Calcul : `pct(currentValue, avgN(history.slice(0,-1), 4))`. Si `Math.abs(pct) < 1` afficher classe `flat` (gris).
- **Sparkline** 12 dernières semaines en bas-droite, couleur dérivée du signal santé.

Les 8 KPIs (ordre fixe) :

| # | Libellé | Source snapshot | Signal | Direction |
|---|---|---|---|---|
| 1 | Lead median | `lead-time` / `median` | `leadTimeMedianDays` | lowerIsBetter |
| 2 | Cycle median | `cycle-time` / `median` | `cycleTimeMedianDays` | lowerIsBetter |
| 3 | Throughput / 7j | `throughput` / `count` | `throughputWeekly` | higherIsBetter |
| 4 | WIP | `wip` / `count` | `wipCount` | lowerIsBetter |
| 5 | Bug ratio | `dev-time-allocation` / `bugRatio` × 100 | `bugRatio` | lowerIsBetter |
| 6 | Bug cycle | `bug-cycle-time` / `median` | `bugCycleTimeMedianDays` | lowerIsBetter |
| 7 | FTR dev | `first-time-right` / `dev` / `ftrRate` × 100 | (none configurée) | higherIsBetter |
| 8 | Critical aging | `agingWipMetric.compute().issues.filter(critical).length` | dérivé : red si ≥1 | lowerIsBetter |

### Tabs sectionnels

Sous les KPIs. 5 onglets, un seul panel visible à la fois. Onglet actif par défaut : `Livraison`.

| Onglet | Contenu |
|---|---|
| **Livraison** | Charts lead time, cycle time, throughput, throughput pondéré ; full-width : histogramme distribution cycle time avec lignes P50/P85/P95 ; tables by-size (lead, cycle) |
| **Qualité & bugs** | Charts bug throughput, bug cycle time, allocation features/bugs (bar+line), bug backlog (bar+line) |
| **Flux par rôle** | Cartes dev/qa/po (WIP + médiane + FTR) ; charts stage time by role, WIP per role, throughput net, FTR by role, rework ratio, rework by type |
| **Forecast & aging** | Table forecast Monte Carlo ; scatter aging WIP avec lignes percentiles ; full-width : table top items en cours par âge avec liens Jira |
| **Avancé** | Charts lead normalized, cycle normalized, flow efficiency, lead by size sélecteur bucket, cycle by size sélecteur bucket |

Switch d'onglet par clic sur le label. Pas de routing URL (state purement local au DOM, toggle via classe `.active`).

### Cartes par rôle (onglet Flux)

3 cartes côte à côte. Chacune affiche :

- Nom du rôle (`Dev` / `QA` / `PO`).
- Trois statistiques inline : WIP, médiane stage time (jours), FTR rate (%).
- Bordure haute colorée par rôle (violet dev, vert qa, orange po).

### Comportements conservés (cf. `description.md`)

- Bouton `?` (`.help-btn`) à côté de chaque titre de chart et chaque libellé de KPI ayant une entrée dans `HELP_TEXTS`. Survol → popover sombre (`.help-popover`) avec titre + description.
- Bouton zoom (`⤢`) en haut-droite de chaque `.chart-card` → modal plein écran avec re-render du chart.
- Tooltips Chart.js par défaut au survol des courbes.

## Cas limites

- Snapshot vide → `generateReport` lève déjà `Aucun snapshot. Lancer 'npm run snapshots' d'abord.` (comportement conservé).
- Aucun KPI configuré dans `healthThresholds` → tous les signaux = `none`, statut verdict = `✓ SAIN`, dots gris dans KPI grid.
- Historique snapshot < 5 semaines → delta 4 sem affiche `—` (référence non calculable).
- Aucun aging critical/at-risk → bloc Top-3 affiche carte verte unique.
- Aging critical < 3 → compléter avec at-risk ; si total < 3, afficher seulement les présents.
- Sparkline avec < 4 points → afficher quand même (Chart.js gère).
- Une métrique by-size sans donnée pour un bucket → bouton bucket désactivé (comportement conservé via `singleBucket` dans `initBucketSelector`).
- Sync stale (> 7j) → bandeau d'alerte stale **conservé** entre le bandeau verdict et le bloc actions.
- Forecast vide (pas de throughput récent) → ligne `Pas de throughput récent.` dans la table forecast (conservé).

## Ce qui ne change pas

- L'API publique : `generateReport(db, projectKey, jiraBaseUrl, outputPath, config, healthThresholds)` et `renderHtml(input)` conservent leur signature.
- La structure des snapshots et des métriques. Aucune nouvelle métrique, aucun nouveau champ DB.
- Les helpers exportés : `buildBucketSeries`, `buildRoleSeries`, `evalLowerBetter`, `evalHigherBetter`, `computeMovingAvg`.
- La table `metric_snapshots` et le pipeline `sync → snapshots → report`.
- Les liens Jira (`issueLink` helper).
- Le bandeau stale et son seuil 7 jours.
- Les tooltips d'aide (`HELP_TEXTS`) et le zoom modal (signature, comportement, plugins Chart.js).
- Le toggle clair/sombre est **supprimé** : le design Cockpit est exclusivement sombre. La clé localStorage `lean-theme` n'est plus lue ni écrite.

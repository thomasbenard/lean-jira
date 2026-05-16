# lean-jira — Spécification fonctionnelle — index

CLI Jira → SQLite → métriques de flux Lean → rapport HTML autonome.

Découpé par thème :

| Fichier | Contenu |
|---|---|
| [overview.md](spec-fonctionnelle/overview.md) | Vue d'ensemble, cas d'usage cible. |
| [cli.md](spec-fonctionnelle/cli.md) | Commandes (`sync`, `metrics`, `snapshots`, `report`, `refresh`, `validate`, `autoconfig`) + options. |
| [configuration.md](spec-fonctionnelle/configuration.md) | Fichier `config.yaml` : `jira`, `board.columns` (types, dérivation statuts), `metrics`, `db`. |
| [metrics.md](spec-fonctionnelle/metrics.md) | Principe team-done, filtre outliers, buckets de taille, catalogue des 24 métriques, stats, forecast Monte Carlo. |
| [report.md](spec-fonctionnelle/report.md) | Rapport HTML : en-tête, 4 sections (Livraison, Bugs, Capacité, Flux par rôle), adaptation à `metrics.estimation.method`. |

Spec technique correspondante : [`spec-technique.md`](spec-technique.md). Formules détaillées : [`metrics-formulas.md`](metrics-formulas.md).

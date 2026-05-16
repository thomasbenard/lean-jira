# lean-jira — Spécification technique — index

Architecture, schéma DB, conventions, pipeline de synchronisation, rapport HTML, mode fake.

Découpé par thème :

| Fichier | Contenu |
|---|---|
| [overview.md](spec-technique/overview.md) | Stack, schéma d'architecture, dépendances, conventions générales (dates, estimation, sprints, outliers). |
| [invariants.md](spec-technique/invariants.md) | Règles transverses non négociables : `team-done` vs `resolutiondate`, working days, taxonomy auto-dérivée, population cycle-time, fenêtres de snapshot. |
| [database.md](spec-technique/database.md) | Schéma SQLite : `issues`, `transitions`, `statuses`, `sprints`, `sync_log`, `issue_field_changes`, `issue_sprints`, `metric_snapshots`. |
| [metrics-layer.md](spec-technique/metrics-layer.md) | Interface plugin `Metric<T>`, registre `ALL_METRICS`, structure `MetricConfig`. |
| [autoconfig.md](spec-technique/autoconfig.md) | Commande `autoconfig` : inférence colonnes board, fusion config existante, enrichissement legacy statuses. |
| [sync.md](spec-technique/sync.md) | Flux de synchronisation (`sync.ts`) : statuses → sprints → issues + transitions, sync incrémental, bulk close. |
| [report.md](spec-technique/report.md) | Rapport HTML (`report/generate.ts`) : signaux de santé, personnalisation, snapshots historiques. |
| [fake-mode.md](spec-technique/fake-mode.md) | Mode fake (output déterministe) : `clock.ts`, `random.ts`, `clientFactory.ts`, fixtures JSON embarquées. |

Formules des métriques : voir [`metrics-formulas.md`](metrics-formulas.md).

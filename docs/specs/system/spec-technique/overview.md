# Stack, architecture, dépendances

[← Index](../spec-technique.md)

## Stack

Node.js · TypeScript 6 · better-sqlite3 · Axios · Commander.js · Chart.js (rapport uniquement, via CDN)

---

## Architecture

```
Jira REST API v2 + Agile API
        │
        ▼
  src/jira/client.ts      ← HTTP Axios, pagination, 200ms sleep entre pages
        │
        ▼
  src/sync.ts             ← Orchestration : statuses, sprints, issues, transitions
        │
        ▼
  src/db/store.ts         ← better-sqlite3, WAL mode, transactions atomiques
        │
    SQLite DB
        │
        ├── src/metrics/          ← Registre de métriques (plugin pattern)
        │       ├── index.ts      ← ALL_METRICS, runAllMetrics, runMetric
        │       └── utils.ts      ← buildDeliveredCte, percentiles, outliers, working-days, fetchDeliveredTransitions, groupByIssue, computeRoleDays, toRoleStatuses
        │
        ├── src/snapshots/        ← Backfill historique hebdo
        │       └── compute.ts    ← backfillSnapshots, computeHistoricWip
        │
        └── src/report/           ← Rendu HTML (Chart.js, inline CSS+JS)
                └── generate.ts   ← generateReport → fichier .html autonome
```

**Point d'entrée** : `src/main.ts` — Commander.js route les commandes et construit le `MetricConfig` runtime via `buildMetricConfig(db, app)`.

---

## Dépendances

| Package | Usage |
|---|---|
| `better-sqlite3` | SQLite synchrone, WAL mode |
| `axios` | HTTP client Jira |
| `commander` | Parsing CLI |
| `yaml` | Lecture `config.yaml` |
| `typescript` | Transpilation |

---

## Conventions

- **Dates** : ISO 8601 en SQLite. Comparaisons par tri lexicographique (`substr(col, 1, 10)`).
- **Estimation** : 1 jour-personne = 28 800 s (convention Atlassian 8 h/j).
- **Sprints** : `issues.current_sprint_id` = sprint actif courant uniquement ; sprints passés ignorés.
- **Outliers** : filtre Tukey côté droit uniquement (cycle time ≥ 0, pas de queue gauche).

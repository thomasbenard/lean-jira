# lean-jira — Spécification technique

## Vue d'ensemble

CLI TypeScript qui synchronise les données d'un board Jira Kanban vers SQLite, puis calcule et visualise des métriques de flux Lean (lead time, cycle time, throughput, WIP).

**Cas d'usage cible** : équipe Agile/Kanban souhaitant piloter par les métriques de flux sans dépendance à des outils BI tiers.

---

## Commandes CLI

| Commande | Description |
|---|---|
| `npm run sync` | Pull Jira → SQLite (issues + transitions + sprints) |
| `npm run metrics` | Calcule et affiche toutes les métriques |
| `npm run snapshots` | Recalcule l'historique hebdomadaire (`metric_snapshots`) |
| `npm run report` | Génère un rapport HTML autonome avec charts de tendances |
| `npm run build` | Compile TypeScript → `./dist` |
| `npm start` | Lance le build compilé |

### Options `metrics`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-m, --metric <name>` | Métrique unique à exécuter |
| `--json` | Sortie JSON brut |
| `--include-outliers` | Ne pas filtrer les outliers extrêmes |

### Options `report`

| Option | Description |
|---|---|
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) |

---

## Architecture

```
Jira Server API (REST v2)
        │
        ▼
  src/jira/client.ts      ← HTTP Axios, pagination, 200ms sleep entre pages
        │
        ▼
  src/sync.ts             ← Orchestration : issues, transitions, sprints
        │
        ▼
  src/db/store.ts         ← better-sqlite3, WAL mode, transactions atomiques
        │
    SQLite DB
        │
        ├── src/metrics/          ← Registre de métriques (plugin pattern)
        │       └── index.ts      ← ALL_METRICS, runAllMetrics, runMetric
        │
        ├── src/snapshots/        ← Backfill historique hebdo
        │       └── compute.ts    ← backfillSnapshots, computeHistoricWip
        │
        └── src/report/           ← Rendu HTML (Chart.js, inline CSS+JS)
                └── generate.ts   ← generateReport → fichier .html autonome
```

**Point d'entrée** : `src/main.ts` — Commander.js route `sync` / `metrics` / `snapshots` / `report` / `list-metrics`.

---

## Configuration (`config.yaml`)

```yaml
jira:
  baseUrl: "https://your-jira.atlassian.net"
  email: "user@example.com"
  apiToken: "xxx"
  projectKey: "KECK"
  boardId: 42
  todoStatuses:
    - "To Do"
  devStartStatuses:
    - "In Development"
  inProgressStatuses:
    - "In Development"
    - "In Review"
  doneStatuses:
    - "Done"

metrics:
  cutoffDate: "2024-01-01"          # Ignorer les issues résolues avant cette date
  bugIssueTypes:
    - "Bug"

db:
  path: "./jira.db"
```

### Rôle des buckets de statuts

| Paramètre | Rôle dans les métriques |
|---|---|
| `todoStatuses` | Début du **lead time** (premier passage dans ce statut) |
| `devStartStatuses` | Début du **cycle time** (premier passage en dev actif) |
| `inProgressStatuses` | Calcul du **WIP** courant et historique |
| `doneStatuses` | Non utilisé directement — `resolved_at` vient du champ Jira `resolutiondate` |

---

## Base de données (SQLite)

### Tables

#### `issues`
Snapshot courant de chaque issue Jira.

| Colonne | Type | Description |
|---|---|---|
| `key` | TEXT PK | Clé Jira (ex. `PROJ-123`) |
| `summary` | TEXT | Titre |
| `issue_type` | TEXT | Type (Story, Bug, Task…) |
| `created_at` | TEXT | ISO 8601 |
| `resolved_at` | TEXT | ISO 8601, `NULL` si non résolue. Source : champ Jira `resolutiondate` |
| `current_status` | TEXT | Statut actuel |
| `assignee` | TEXT | Nom affiché |
| `priority` | TEXT | |
| `current_sprint_id` | INTEGER | Sprint actif courant uniquement |
| `original_estimate_seconds` | INTEGER | Estimation originale (Atlassian : 1 jour = 28 800 s) |

#### `transitions`
Historique complet des changements de statut. **Source de vérité pour toutes les métriques temporelles.**

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `issue_key` | TEXT FK → issues | |
| `from_status` | TEXT | `NULL` pour la création |
| `to_status` | TEXT | |
| `transitioned_at` | TEXT | ISO 8601 |

Index : `issue_key`, `to_status`, `transitioned_at`.

#### `sprints`

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | ID Jira |
| `name` | TEXT | |
| `state` | TEXT | `active` / `closed` / `future` |
| `start_date` | TEXT | |
| `end_date` | TEXT | |
| `board_id` | INTEGER | |

#### `sync_log`
Audit trail de chaque exécution `sync`.

| Colonne | Description |
|---|---|
| `synced_at` | Horodatage |
| `issues_count` | Nombre d'issues traitées |
| `project_key` | Clé projet |

#### `metric_snapshots`
Historique hebdomadaire des métriques. Format long : une ligne par `(date, métrique, bucket, stat)`.

| Colonne | Type | Description |
|---|---|---|
| `snapshot_date` | TEXT | Dimanche fin de semaine ISO |
| `metric_name` | TEXT | Identifiant métrique |
| `bucket` | TEXT | Taille XS/S/M/L/XL/BUG/UNESTIMATED, ou `''` |
| `stat` | TEXT | `median`, `p85`, `count`, `estimatedDays` |
| `value` | REAL | |

PK composite : `(snapshot_date, metric_name, bucket, stat)`.

---

## Métriques

### Interface commune

```typescript
interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database, config: MetricConfig): T;
}
```

Ajouter une métrique = implémenter `Metric<T>` + l'enregistrer dans `ALL_METRICS` (`src/metrics/index.ts`).

### `MetricConfig`

| Champ | Description |
|---|---|
| `todoStatuses` | Statuts marquant l'entrée en backlog |
| `devStartStatuses` | Statuts marquant le début du dev actif |
| `inProgressStatuses` | Statuts comptés dans le WIP |
| `doneStatuses` | (actuellement non requis en SQL — resolved_at utilisé) |
| `cutoffDate` | Ignorer les issues résolues avant cette date |
| `windowEndDate` | Ignorer les issues résolues après cette date (snapshots) |
| `excludeOutliers` | Filtre Tukey upper fence (défaut : `true`) |
| `bugIssueTypes` | Types Jira traités comme bugs |

### Filtre outliers

Tukey upper fence côté droit uniquement : `Q3 + 1.5 × IQR`. Retire les valeurs extrêmes pour stabiliser moyenne et percentiles sans toucher médiane ni P85. Appliqué avant tout calcul statistique si `excludeOutliers = true`.

### Catalogue des métriques

| Nom | Mesure | Période |
|---|---|---|
| `lead-time` | Backlog → résolution (premier passage en TODO) | Toutes issues résolues |
| `lead-time-by-size` | Lead time agrégé par bucket de taille | Idem |
| `lead-time-normalized` | Lead time réel / estimation (ratio) | Issues estimées non-bug |
| `cycle-time` | Début dev → résolution | Toutes issues résolues |
| `cycle-time-by-size` | Cycle time par bucket de taille | Idem |
| `cycle-time-normalized` | Cycle time réel / estimation (ratio) | Issues estimées non-bug |
| `throughput` | Issues livrées / semaine (débit brut) | Rolling selon config |
| `throughput-weighted` | Jours-personnes estimés livrés / semaine | Issues estimées non-bug |
| `bug-cycle-time` | Cycle time des bugs uniquement | Issues de type bug |
| `bug-throughput` | Bugs livrés / semaine | Issues de type bug |
| `wip` | Issues en cours dans le sprint actif | Snapshot courant |

### Calcul statistique commun (`DurationStats`)

Pour chaque métrique temporelle :

| Stat | Description |
|---|---|
| `count` | Issues incluses (après filtre outliers) |
| `excludedOutliers` | Issues rejetées par Tukey |
| `avgDays` | Moyenne |
| `medianDays` | Médiane (P50) |
| `p85Days` | 85e percentile |
| `p95Days` | 95e percentile |

### Buckets de taille

Basés sur `original_estimate_seconds` (1 j = 28 800 s) :

| Bucket | Critère |
|---|---|
| XS | < 0,5 j |
| S | 0,5 – 1 j |
| M | 1 – 3 j |
| L | 3 – 5 j |
| XL | ≥ 5 j |
| BUG | Issue de type bug (quelle que soit l'estimation) |
| UNESTIMATED | Pas d'estimation ou estimation ≤ 0 |

---

## Snapshots historiques

`backfillSnapshots` recalcule l'ensemble de l'historique depuis `cutoffDate` (défaut `2024-01-01`) jusqu'à aujourd'hui, par fenêtres hebdomadaires alignées sur le dimanche.

- **Métriques temporelles** (lead time, cycle time…) : fenêtre glissante 30 jours.
- **Métriques de débit** (throughput, bug-throughput) : fenêtre 7 jours.
- **WIP historique** : reconstruit depuis les transitions (`computeHistoricWip`) — dernier statut connu avant la date, sans scoping sprint.

Toute l'opération est atomique (transaction SQLite : `DELETE` + `INSERT OR REPLACE`).

---

## Rapport HTML (`report`)

Fichier HTML autonome (aucune dépendance serveur). Dépendance externe : Chart.js 4 via CDN.

### Contenu

1. **KPIs actuels** (dernière fenêtre) : lead time médian, cycle time médian, throughput, WIP, bugs livrés, bug cycle médian.
2. **Tendances hebdomadaires** : 8 charts Chart.js (lead time, cycle time, throughput, throughput pondéré, WIP, bugs, bug cycle time, cycle normalisé).
3. **Par taille** (dernière fenêtre) : tableaux lead time et cycle time par bucket.
4. **Popovers d'aide** au survol pour chaque métrique.

### Prérequis avant génération

```bash
npm run sync       # Données fraîches
npm run snapshots  # Historique à jour
npm run report     # Génère ./report.html
```

---

## Flux de synchronisation (`sync`)

1. Fetch tous les sprints du board (`boardId`).
2. Fetch toutes les issues du projet avec changelog (pagination 100 issues/page, 200 ms entre pages).
3. Mappe chaque issue : extrait `current_sprint_id` = sprint actif courant uniquement (ignore les sprints historiques fermés).
4. Upsert issues + sprints en transaction.
5. Pour chaque issue : `replaceTransitions` (supprime les anciennes, insère les nouvelles) — garantit la cohérence si Jira modifie l'historique.
6. Log audit dans `sync_log`.

**Note `resolved_at`** : lu depuis `resolutiondate` Jira, pas déduit des transitions. Résistant aux bulk closes (transitions vers Done en masse qui ne modifient pas `resolutiondate`).

---

## Dépendances principales

| Package | Usage |
|---|---|
| `better-sqlite3` | SQLite synchrone, WAL mode |
| `axios` | HTTP client Jira |
| `commander` | Parsing CLI |
| `yaml` | Lecture `config.yaml` |
| `typescript` | Transpilation |

---

## Conventions

- **Temps** : toutes les dates en ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) dans SQLite. Les comparaisons de dates se font par tri lexicographique (`substr(col, 1, 10)`).
- **Estimation** : 1 jour-personne = 28 800 secondes (convention Atlassian par défaut).
- **Sprints** : une issue ne référence qu'un sprint actif courant dans `issues.current_sprint_id` — les sprints passés sont ignorés volontairement.
- **Outliers** : filtre Tukey côté droit uniquement (cycle time ≥ 0, pas de queue gauche).

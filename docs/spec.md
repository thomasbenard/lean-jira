# lean-jira — Spécification technique

## Vue d'ensemble

CLI TypeScript qui synchronise les données d'un board Jira Kanban vers SQLite, puis calcule et visualise des métriques de flux Lean (lead time, cycle time, throughput, WIP, flow efficiency, aging WIP, forecast Monte Carlo).

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
  src/sync.ts             ← Orchestration : statuses, sprints, issues, transitions
        │
        ▼
  src/db/store.ts         ← better-sqlite3, WAL mode, transactions atomiques
        │
    SQLite DB
        │
        ├── src/metrics/          ← Registre de métriques (plugin pattern)
        │       ├── index.ts      ← ALL_METRICS, runAllMetrics, runMetric
        │       └── utils.ts      ← buildDeliveredCte, percentiles, outliers, working-days
        │
        ├── src/snapshots/        ← Backfill historique hebdo
        │       └── compute.ts    ← backfillSnapshots, computeHistoricWip
        │
        └── src/report/           ← Rendu HTML (Chart.js, inline CSS+JS)
                └── generate.ts   ← generateReport → fichier .html autonome
```

**Point d'entrée** : `src/main.ts` — Commander.js route `sync` / `metrics` / `snapshots` / `report` / `list-metrics`. Construit le `MetricConfig` runtime via `buildMetricConfig(db, app)` qui filtre les statuts `category_key='done'` hors des listes in-progress / active / queue.

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
    - "Ready for QA"
  activeStatuses:                 # touch time (sous-ensemble in-progress)
    - "In Development"
  queueStatuses:                  # queue time (sous-ensemble in-progress)
    - "In Review"
    - "Ready for QA"
  doneStatuses:                   # fallback statuts renommés (legacy)
    - "Done"
    - "To Be Validated"

metrics:
  cutoffDate: "2024-01-01"          # Ignorer les issues livrées (team-done) avant cette date
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
| `inProgressStatuses` | Calcul du **WIP** courant et historique. Filtré au runtime contre les statuts `category_key='done'`. |
| `activeStatuses` | Sous-ensemble in-progress = "touch time" pour `flow-efficiency`. Filtré contre done-category. |
| `queueStatuses` | Sous-ensemble in-progress = "queue time" pour `flow-efficiency`. Filtré contre done-category. |
| `doneStatuses` | Source de vérité **livraison** unioniée avec `statuses.category_key='done'`. Sert à : (1) borner la fin de toutes les métriques de durée et débit (`done_at` = 1ère transition vers un de ces statuts) ; (2) lister les statuts renommés historiquement absents de `/rest/api/2/status` (ex: "To Be Validated", "Delivred"). |
| `metrics.cutoffDate` | Borne basse globale : issues livrées avant sont ignorées. |
| `metrics.bugIssueTypes` | Bucket dédié BUG, exclu des métriques normalized/weighted. |

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
| `resolved_at` | TEXT | ISO 8601, `NULL` si non résolue. Source : champ Jira `resolutiondate`. **Conservé pour audit ; aucune métrique ne l'utilise — la livraison est dérivée des transitions.** |
| `current_status` | TEXT | Statut actuel |
| `assignee` | TEXT | Nom affiché |
| `priority` | TEXT | |
| `current_sprint_id` | INTEGER | Sprint actif courant uniquement |
| `original_estimate_seconds` | INTEGER | Estimation originale (Atlassian : 1 jour = 28 800 s) |

#### `transitions`
Historique complet des changements de statut. **Source de vérité pour toutes les métriques de durée et de débit (via `done_at` = 1ère transition vers statut team-done).**

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `issue_key` | TEXT FK → issues | |
| `from_status` | TEXT | `NULL` pour la création |
| `to_status` | TEXT | |
| `transitioned_at` | TEXT | ISO 8601 |

Index : `issue_key`, `to_status`, `transitioned_at`.

#### `statuses`
Mapping statut → catégorie Atlassian standard. Populé par `sync` depuis `/rest/api/2/status`. Source de vérité préférée à `doneStatuses` du config (immune aux renommages de workflow).

| Colonne | Type | Description |
|---|---|---|
| `name` | TEXT PK | Nom du statut tel que retourné par l'API |
| `category_key` | TEXT | `new` / `indeterminate` / `done` |
| `category_name` | TEXT | Nom localisé de la catégorie |

**Caveat** : l'endpoint `/rest/api/2/status` ne retourne que les statuts actuellement actifs sur l'instance. Les statuts historiques renommés présents dans `transitions` (ex: "To Be Validated", "Delivred") n'apparaissent pas et doivent rester dans `config.jira.doneStatuses`.

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
| `stat` | TEXT | `median`, `p85`, `count`, `estimatedDays`, `aggregate`, `activeDays`, `queueDays`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p95` |
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

Construit au runtime par `buildMetricConfig(db, app)` (`src/main.ts`). Les listes `inProgressStatuses` / `activeStatuses` / `queueStatuses` du config YAML sont filtrées contre l'union (`statuses.category_key='done'`) ∪ (`config.doneStatuses`) — un statut "done" du point de vue Jira ne peut jamais polluer les métriques de WIP/flow, même s'il figure dans une liste in-progress du config.

| Champ | Description |
|---|---|
| `todoStatuses` | Statuts marquant l'entrée en backlog |
| `devStartStatuses` | Statuts marquant le début du dev actif |
| `inProgressStatuses` | Statuts comptés dans le WIP (filtrés contre done-category) |
| `activeStatuses` | Sous-ensemble in-progress = touch time pour `flow-efficiency` |
| `queueStatuses` | Sous-ensemble in-progress = queue time pour `flow-efficiency` |
| `doneStatuses` | Union DB-derived (`statusCategory='done'`) + config legacy. Définit `done_at` pour toutes les métriques de durée et de débit. |
| `cutoffDate` | Ignorer les issues livrées (team-done) avant cette date |
| `windowEndDate` | Ignorer les issues livrées après cette date (snapshots) |
| `excludeOutliers` | Filtre Tukey upper fence (défaut : `true`) |
| `bugIssueTypes` | Types Jira traités comme bugs |

### Helper `buildDeliveredCte`

`src/metrics/utils.ts` exporte :

```typescript
buildDeliveredCte(doneStatuses: string[]) → { cte: string; args: string[] }
```

Retourne le fragment SQL :
```sql
delivered AS (
  SELECT issue_key, MIN(transitioned_at) AS done_at
  FROM transitions
  WHERE to_status IN (?, ?, …)
  GROUP BY issue_key
)
```

Toutes les métriques de durée et de débit utilisent ce helper pour borner la fin du calcul à `done_at` (et non plus à `issues.resolved_at`). Le filtre `cutoffDate`/`windowEndDate` s'applique sur `d.done_at`.

### Filtre outliers

Tukey upper fence côté droit uniquement : `Q3 + 1.5 × IQR`. Retire les valeurs extrêmes pour stabiliser moyenne et percentiles sans toucher médiane ni P85. Appliqué avant tout calcul statistique si `excludeOutliers = true`.

### Catalogue des métriques

Toutes les métriques de durée prennent fin à `done_at` (= 1ère transition vers un statut team-done). Toutes les métriques de débit comptent les transitions vers ce même statut.

| Nom | Mesure | Période |
|---|---|---|
| `lead-time` | TODO → team-done | Issues livrées |
| `lead-time-by-size` | Lead time agrégé par bucket de taille | Idem |
| `lead-time-normalized` | Lead time réel / estimation (ratio) | Issues estimées non-bug |
| `cycle-time` | Début dev → team-done | Issues livrées |
| `cycle-time-by-size` | Cycle time par bucket de taille | Idem |
| `cycle-time-normalized` | Cycle time réel / estimation (ratio) | Issues estimées non-bug |
| `throughput` | Issues livrées / semaine (transitions team-done) | Rolling selon config |
| `throughput-weighted` | Jours-personnes estimés livrés / semaine | Issues estimées non-bug |
| `bug-cycle-time` | Cycle time des bugs uniquement | Issues de type bug |
| `bug-throughput` | Bugs livrés / semaine | Issues de type bug |
| `wip` | Issues en cours dans le sprint actif | Snapshot courant |
| `flow-efficiency` | Ratio temps actif / (actif + queue) sur la phase cycle-time | Issues livrées |
| `aging-wip` | Âge des items en cours vs percentiles cycle-time historiques | Snapshot courant |
| `forecast` | Monte Carlo sur 12 dernières semaines de throughput | Live (skip snapshots) |

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

- **Métriques temporelles** (lead, cycle, normalized, bug-cycle, flow-efficiency) : fenêtre glissante 30 jours.
- **Métriques de débit** (throughput, bug-throughput, throughput-weighted) : fenêtre 7 jours.
- **By-size + aging-wip** : cumulatif depuis `cutoffDate` global.
- **WIP historique** : reconstruit depuis les transitions (`computeHistoricWip`) — dernier statut connu avant la date, filtré contre done-category, sans scoping sprint.
- **`forecast`** : skip des snapshots (Monte Carlo non déterministe ; calculé live en report).

Toute l'opération est atomique (transaction SQLite : `DELETE` + `INSERT OR REPLACE`).

---

## Rapport HTML (`report`)

Fichier HTML autonome (aucune dépendance serveur). Dépendance externe : Chart.js 4 via CDN.

### Contenu

1. **KPIs actuels** (dernière fenêtre) : lead time médian, cycle time médian, throughput, WIP, bugs livrés, bug cycle médian, flow efficiency.
2. **Tendances hebdomadaires** : 9 charts Chart.js (lead time, cycle time, throughput, throughput pondéré, WIP, bugs, bug cycle time, cycle normalisé, flow efficiency).
3. **Distribution cycle time** : histogramme avec lignes P50/P85/P95.
4. **Forecast Monte Carlo** : table P15/P50/P85/P95 par horizon (1/2/4/8 semaines), calculé live.
5. **Aging WIP** : scatter (statut × âge) avec lignes seuil P50/P85/P95 + table top 15 par âge, classification de risque.
6. **Par taille** (dernière fenêtre) : tableaux lead time et cycle time par bucket.
7. **Popovers d'aide** au survol pour chaque métrique.

### Prérequis avant génération

```bash
npm run sync       # Données fraîches
npm run snapshots  # Historique à jour
npm run report     # Génère ./report.html
```

---

## Flux de synchronisation (`sync`)

1. Fetch la liste globale des statuts via `/rest/api/2/status` ; upsert dans `statuses` (avec `category_key`).
2. Fetch tous les sprints du board (`boardId`).
3. Fetch toutes les issues du projet avec changelog (pagination 100 issues/page, 200 ms entre pages).
4. Mappe chaque issue : extrait `current_sprint_id` = sprint actif courant uniquement (ignore les sprints historiques fermés).
5. Upsert issues + sprints en transaction.
6. Pour chaque issue : `replaceTransitions` (supprime les anciennes, insère les nouvelles) — garantit la cohérence si Jira modifie l'historique.
7. Log audit dans `sync_log`.

**Note `resolved_at`** : lu depuis `resolutiondate` Jira, conservé en colonne pour audit mais **non utilisé par les métriques**. La date de livraison vient de `done_at` = MIN(transition vers un statut de la `doneSet`).

**Bulk close 2025-10-25** : la résilience venait initialement du fait que `resolutiondate` était préservée à travers la migration. Avec le passage à `done_at`, la résilience repose désormais sur `cutoffDate >= 2025-11-01` qui exclut les issues bulk-closées (leur `done_at` tombe le jour de la migration).

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

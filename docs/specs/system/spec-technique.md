# lean-jira — Spécification technique

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

## Base de données (SQLite)

WAL mode, foreign keys activées. Schéma auto-appliqué à l'ouverture (`schema.sql`). Colonnes ajoutées par migration PRAGMA détectée au démarrage.

### `issues`

Snapshot courant de chaque issue Jira.

| Colonne | Type | Description |
|---|---|---|
| `key` | TEXT PK | Clé Jira (ex. `PROJ-123`) |
| `summary` | TEXT | Titre |
| `issue_type` | TEXT | Type (Story, Bug, Task…) |
| `created_at` | TEXT | ISO 8601 |
| `resolved_at` | TEXT | `resolutiondate` Jira. **Audit uniquement — aucune métrique ne l'utilise.** |
| `current_status` | TEXT | Statut actuel |
| `assignee` | TEXT | |
| `priority` | TEXT | |
| `current_sprint_id` | INTEGER | Sprint actif courant uniquement |
| `original_estimate_seconds` | INTEGER | 1 jour Atlassian = 28 800 s |

### `transitions`

Historique complet des changements de statut. **Source de vérité pour toutes les métriques de durée et de débit.**

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `issue_key` | TEXT FK → issues | |
| `from_status` | TEXT | `NULL` à la création |
| `to_status` | TEXT | |
| `transitioned_at` | TEXT | ISO 8601 |

Index : `issue_key`, `to_status`, `transitioned_at`.

### `statuses`

Mapping statut → catégorie Atlassian. Populé par `sync` depuis `/rest/api/2/status`.

| Colonne | Type | Description |
|---|---|---|
| `name` | TEXT PK | Nom exact retourné par l'API |
| `category_key` | TEXT | `new` / `indeterminate` / `done` |
| `category_name` | TEXT | Nom localisé |

**Caveat** : `/rest/api/2/status` ne retourne que les statuts actifs. Les statuts historiques renommés présents dans `transitions` (ex: "To Be Validated", "Delivred") n'y apparaissent pas ; ils doivent rester dans `config.jira.doneStatuses`.

### `sprints`

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | ID Jira |
| `name` | TEXT | |
| `state` | TEXT | `active` / `closed` / `future` |
| `start_date` | TEXT | |
| `end_date` | TEXT | |
| `board_id` | INTEGER | |

### `sync_log`

| Colonne | Description |
|---|---|
| `synced_at` | Horodatage ISO |
| `issues_count` | Issues traitées |
| `project_key` | Clé projet |

### `metric_snapshots`

Long format : une ligne par `(date, métrique, bucket, stat)`.

| Colonne | Type | Description |
|---|---|---|
| `snapshot_date` | TEXT | Dimanche fin de semaine |
| `metric_name` | TEXT | Identifiant métrique |
| `bucket` | TEXT | XS/S/M/L/XL/BUG/UNESTIMATED, ou `''` |
| `stat` | TEXT | `median`, `p85`, `count`, `estimatedDays`, `aggregate`, `activeDays`, `queueDays`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p95` |
| `value` | REAL | |

PK composite : `(snapshot_date, metric_name, bucket, stat)`.
Index : `snapshot_date`, `metric_name`.

---

## Couche métriques

### Interface plugin

```typescript
interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database, config: MetricConfig): T;
}
```

Enregistrement dans `ALL_METRICS` (`src/metrics/index.ts`). Chaque fichier `src/metrics/<name>.ts` implémente une métrique.

**Ajout d'une métrique** : implémenter `Metric<T>`, enregistrer dans `ALL_METRICS`, ajouter une branche `extractStats` dans `snapshots/compute.ts` si la shape de résultat est nouvelle (voir [`metrics-formulas.md`](metrics-formulas.md) § Snapshots pour les shapes reconnues).

### `MetricConfig`

Construit par `buildMetricConfig(db, app)` dans `src/main.ts`. Les listes de statuts sont d'abord dérivées depuis `config.board.columns` via `deriveStatusConfig()`, puis `buildMetricConfig` construit le `doneSet` = union `statuses.category_key='done'` (DB) ∪ `derived.doneStatuses`. Les listes `inProgressStatuses` / `activeStatuses` / `queueStatuses` sont filtrées contre ce set : un statut done ne peut jamais polluer les métriques WIP/flow. Un warning liste les statuts retirés au démarrage.

| Champ | Description |
|---|---|
| `todoStatuses` | Début lead time |
| `devStartStatuses` | Début cycle time |
| `inProgressStatuses` | WIP (filtrés contre doneSet) |
| `activeStatuses` | Touch time pour flow-efficiency (filtrés) |
| `queueStatuses` | Queue time pour flow-efficiency (filtrés) |
| `devStatuses` | Statuts colonnes `role: dev` ; `[]` si aucun rôle configuré |
| `qaStatuses` | Statuts colonnes `role: qa` ; `[]` si aucun rôle configuré |
| `poStatuses` | Statuts colonnes `role: po` ; `[]` si aucun rôle configuré |
| `doneStatuses` | Union DB-derived + config legacy → définit `done_at` |
| `cutoffDate` | Borne basse (issues livrées avant ignorées) |
| `windowEndDate` | Borne haute (injecté par le système de snapshots) |
| `excludeOutliers` | Tukey upper fence, défaut `true` |
| `bugIssueTypes` | Types routés dans bucket BUG |

> Formules, primitives (`buildDeliveredCte`, `workingDaysBetween`, Tukey) et algorithmes détaillés par métrique : voir [`metrics-formulas.md`](metrics-formulas.md).

---

## Commande `autoconfig` (`main.ts`)

Génère `board.columns` depuis l'API Jira Agile par inférence de position. Usage : `npm run autoconfig` (aperçu stdout) ou `npm run autoconfig -- --apply` (écrase `config.yaml`).

### Fonctions exportées

| Fonction | Signature | Description |
|---|---|---|
| `inferBoardColumns` | `(boardConfig: JiraBoardConfig, statuses: JiraStatus[]) → InferredColumn[]` | Inférence position : première=todo, dernière=done. Colonnes intermédiaires : `queue` si le nom contient un mot-clé de `QUEUE_KEYWORDS` (review, validation, valider, attente, wait, waiting, approval, approuver, staging, qa), sinon `active`. Premier `active` → `devStart: true`. Mot-clé déclencheur stocké dans `queueKeyword` (affiché en commentaire YAML). |
| `renderBoardColumnsYaml` | `(columns: InferredColumn[]) → string` | Génère YAML avec commentaires inline, `legacyStatuses` par colonne. |
| `enrichWithLegacyStatuses` | `(columns, boardConfig, allStatuses, db) → EnrichmentResult` | Croise `transitions` DB avec l'API Jira pour détecter les statuts legacy : mute `columns[todoIdx/doneIdx].legacyStatuses` en place, retourne `{ unresolvable }`. |
| `mergeColumns` | `(existing: BoardColumn[], inferred: InferredColumn[]) → { columns: InferredColumn[]; warnings: string[] }` | Fusionne colonnes inférées avec config existante : préserve `type`, `devStart`, `role`, `legacyStatuses` par nom. Retourne warnings (nouvelles colonnes, colonnes absentes) sans side-effect. |
| `buildUnresolvableComment` | `(names: string[]) → string` | Génère un bloc de commentaires YAML listant les statuts non classifiés, prêt à copier-coller. Retourne `""` si liste vide. |

`InferredColumn extends BoardColumn { warning?: string; queueKeyword?: string }` — champs internes utilisés pour les commentaires inline YAML, non écrits dans le fichier de config.

`EnrichmentResult { unresolvable: string[] }`.

### Mode fusion (`autoconfig` avec config existante)

Si `config.board.columns` non vide : `mergeColumns(existingColumns, inferBoardColumns(...))`. Chaque colonne API est réconciliée par nom exact avec la config existante — `type`/`devStart`/`role`/`legacyStatuses` préservés, `statuses` mis à jour depuis l'API. Colonnes nouvelles (API seulement) → ajout avec warning. Colonnes orphelines (config seulement) → conservées avec warning. `board.legacyDoneStatuses` préservé tel quel dans `--apply`.

Si `config.board.columns` absent ou vide → inférence complète (comportement premier lancement).

Tous les warnings (nouvelles colonnes, colonnes absentes, statuts unresolvable, devStart manquant) sont collectés pendant le traitement et affichés en bloc à la fin de la sortie.

Si des statuts `unresolvable` existent, un bloc de commentaires YAML (`buildUnresolvableComment`) est ajouté en fin de sortie stdout et en fin du fichier écrit par `--apply`, pour faciliter le copier-coller.

**Algorithme d'enrichissement** :
1. `getDistinctTransitionStatuses(db)` → noms historiques DB.
2. Candidats = noms DB absents des colonnes courantes (`statuses` + `legacyStatuses` de chaque colonne).
3. Pour chaque candidat : si trouvé dans `allStatuses` (API) avec ID absent du board → `category='new'` → `legacyStatuses` colonne todo ; `category='done'` → `legacyStatuses` colonne done ; `category='indeterminate'` → `unresolvable`. Si absent de l'API → `unresolvable`.
4. Statuts `unresolvable` remontés à la commande pour affichage groupé en fin de sortie.

DB access conditionnel : si `config.db.path` n'existe pas, `enrichWithLegacyStatuses` n'est pas appelée.

### `src/db/store.ts` — `getDistinctTransitionStatuses`

```typescript
export function getDistinctTransitionStatuses(db: Database.Database, since?: string): string[]
// SELECT DISTINCT to_status FROM transitions [WHERE transitioned_at >= since]
```

### Backup `--apply`

Avant écriture, copie `config.yaml` → `config.yaml.bak` (gitignored). Le chemin bak est `configPath + ".bak"`.

---

## Flux de synchronisation (`sync.ts`)

1. `GET /rest/api/2/status` → upsert `statuses` (avec `category_key`).
2. `GET /rest/agile/1.0/board/{boardId}/sprint` → upsert `sprints` (pagination 50/page, 200 ms entre pages).
3. Lecture de `sync_log` via `getLastSyncDate()` pour déterminer le mode sync :
   - **Premier sync** (aucune entrée) : récupération complète de toutes les issues.
   - **Sync incrémental** (entrée existante) : `GET …/issue?jql=updated>="<date>"` — seules les issues modifiées depuis le dernier sync sont récupérées. La date ISO est convertie en format JQL `"YYYY-MM-DD HH:MM"` avant injection.
4. Mappe chaque issue récupérée : `current_sprint_id` = sprint actif courant uniquement (ignore les sprints fermés historiques).
5. Upsert `issues` + `sprints` en transaction.
6. Pour chaque issue récupérée : `replaceTransitions` — DELETE + INSERT atomique dans `transitions`. Garantit cohérence si Jira modifie l'historique. Les issues non récupérées restent inchangées en base.
7. Log audit dans `sync_log` (nombre d'issues effectivement récupérées).

Champs récupérés par issue : `summary`, `issuetype`, `status`, `created`, `resolutiondate`, `assignee`, `priority`, `customfield_10020` (sprints), `timeoriginalestimate`.

**Bulk close 2025-10-25** : résilience assurée par `cutoffDate >= 2025-11-01` — les issues bulk-closées ont leur `done_at` le jour de la migration et sont donc exclues.

---

## Rapport HTML (`report/generate.ts`)

`generateReport(db, projectKey, jiraBaseUrl, outputPath, config, healthThresholds?)` lit `metric_snapshots` et produit un fichier HTML autonome (Chart.js via CDN, CSS inline).

### Signaux de santé (`healthThresholds`)

Paramètre optionnel de type `HealthThresholds` (exporté depuis `generate.ts`). Si absent → aucun signal. Structure :

```typescript
interface ThresholdPair { warn: number; crit: number; }
interface HealthThresholds {
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}
```

Helpers d'évaluation (exportés, fonctions pures) :
- `evalLowerBetter(value, t)` : vert si `value <= t.warn`, orange si `<= t.crit`, rouge sinon. `null` ou `t` absent → `"none"`.
- `evalHigherBetter(value, t)` : vert si `value >= t.warn`, orange si `>= t.crit`, rouge sinon. Utilisé pour `throughputWeekly`.

Rendu : `<span class="health-dot health-{green|orange|red}">●</span>` inséré avant la valeur dans la card KPI. Champ `metrics.healthThresholds` dans `board.yaml` → passé par `main.ts` à `generateReport()`.

---

## Snapshots historiques (`snapshots/compute.ts`)

`backfillSnapshots` :
1. Génère toutes les fins de semaine (dimanche) depuis `cutoffDate` jusqu'à aujourd'hui.
2. Pour chaque date, calcule chaque métrique avec `windowEndDate = date`.
3. Efface et réinsère l'intégralité de `metric_snapshots` dans une transaction atomique.

Fenêtres de calcul par type de métrique et shapes de résultat reconnues par `extractStats` : voir [`metrics-formulas.md`](metrics-formulas.md) § Snapshots.

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

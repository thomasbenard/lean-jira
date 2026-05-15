# Ticket 050 — Spec technique

## Vue d'ensemble

Trois nouveaux modules apparaissent :

```
src/store/
├── types.ts          # ReadStore, WriteStore, Store + record types
├── sqlite/
│   ├── index.ts      # SqliteStore (façade)
│   ├── issues.ts     # IssuesRead/Write
│   ├── transitions.ts
│   ├── sprints.ts
│   ├── statuses.ts
│   ├── issueFieldChanges.ts
│   ├── issueSprints.ts
│   ├── snapshots.ts
│   ├── appConfig.ts
│   ├── syncLog.ts
│   └── schema.ts     # openDb + migrate (déplacé depuis src/db/store.ts)
└── (src/db/ disparaît)

src/metrics/
├── context.ts        # MetricsContext + buildMetricsContext(store, config)
└── (toutes les *.ts métriques sont réécrites sans `db`)
```

`src/db/store.ts` et `src/db/schema.sql` sont déplacés sous `src/store/sqlite/`
(le `.sql` reste lu par `openDb` depuis son nouvel emplacement).

## Contrat ReadStore / WriteStore

`src/store/types.ts` :

```typescript
export interface IssueRecord {
  key: string;
  summary: string;
  issueType: string;
  createdAt: string;
  resolvedAt: string | null;
  currentStatus: string;
  assignee: string | null;
  priority: string | null;
  currentSprintId: number | null;
  originalEstimateSeconds: number | null;
  storyPoints: number | null;
  sizeLabel: string | null;
}

export interface TransitionRecord {
  id: number;
  issueKey: string;
  fromStatus: string | null;
  toStatus: string;
  transitionedAt: string;
}

export interface SprintRecord {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  boardId: number;
}

export interface StatusRecord {
  name: string;
  categoryKey: string;
  categoryName: string;
}

export interface IssueFieldChangeRecord {
  issueKey: string;
  fieldName: string;
  fromValue: string | null;
  toValue: string | null;
  changedAt: string;
}

export interface IssueSprintRecord {
  issueKey: string;
  sprintId: number;
}

export interface SnapshotRecord {
  snapshotDate: string;
  metricName: string;
  bucket: string;
  stat: string;
  value: number;
}

export interface SyncLogRecord {
  syncedAt: string;
  issuesCount: number;
  projectKey: string;
}

export interface ReadStore {
  issues: {
    all(): IssueRecord[];
    byKey(key: string): IssueRecord | null;
  };
  transitions: {
    all(): TransitionRecord[];
    byIssue(key: string): TransitionRecord[];
  };
  sprints: {
    all(): SprintRecord[];
    byId(id: number): SprintRecord | null;
  };
  statuses: {
    all(): StatusRecord[];
  };
  issueFieldChanges: {
    byIssueAndField(key: string, field: string): IssueFieldChangeRecord[];
  };
  issueSprints: {
    bySprint(sprintId: number): IssueSprintRecord[];
    byIssue(key: string): IssueSprintRecord[];
  };
  snapshots: {
    all(): SnapshotRecord[];
    byDate(date: string): SnapshotRecord[];
  };
  appConfig: {
    get(key: string): string | null;
  };
  syncLog: {
    lastByProject(projectKey: string): SyncLogRecord | null;
  };
}

export interface WriteStore {
  issues: {
    upsertMany(rows: IssueRecord[]): void;
  };
  transitions: {
    replaceForIssue(key: string, rows: Omit<TransitionRecord, "id">[]): void;
    replaceForIssues(items: { key: string; rows: Omit<TransitionRecord, "id">[] }[]): void;
  };
  sprints: {
    upsertMany(rows: SprintRecord[]): void;
  };
  statuses: {
    upsertMany(rows: StatusRecord[]): void;
  };
  issueFieldChanges: {
    replaceForIssues(items: { key: string; rows: IssueFieldChangeRecord[] }[]): void;
  };
  issueSprints: {
    replaceForIssues(items: { key: string; sprintIds: number[] }[]): void;
  };
  snapshots: {
    replaceAll(rows: SnapshotRecord[]): void;
  };
  appConfig: {
    set(key: string, value: string): void;
  };
  syncLog: {
    append(row: SyncLogRecord): void;
  };
  transaction<T>(fn: () => T): T;
}

export interface Store extends ReadStore, WriteStore {}
```

**Décisions de naming** :

- `byIssue(key)` au lieu de `forIssue(key)` ou `where({ issueKey: key })` :
  cohérent avec `byId`, `byKey`, `byDate`, `bySprint`. Le nom décrit l'index
  de lecture, pas l'intention.
- `upsertMany` / `replaceForIssue` : reflètent le comportement réel —
  `upsert` pour les tables avec PK stable, `replace` pour les tables où on
  remplace l'ensemble des lignes appartenant à une entité parent (cas des
  transitions, des changements de champs, des appartenances sprint).
- `transaction<T>(fn): T` au niveau `WriteStore` plutôt que `Store` : c'est
  une primitive d'écriture. Les writes effectués dans le callback partagent
  la même transaction. Implémentation triviale en SQLite via
  `db.transaction()`.
- Pas de méthode `close()` exposée : le bootstrap dans `main.ts` n'en a pas
  besoin (better-sqlite3 ferme à la fin du process). Si un backend futur en a
  besoin, on étendra l'interface.

## MetricsContext

`src/metrics/context.ts` :

```typescript
import type { ReadStore, IssueRecord, TransitionRecord } from "../store/types";
import type { MetricConfig } from "./types";
import { isoWeek, workingDaysBetween } from "./utils";

export interface CycleTimeSample {
  issueKey: string;
  startedAt: string;
  doneAt: string;
}

export interface MetricsContext {
  // Données brutes filtrées
  issues: IssueRecord[];
  transitions: TransitionRecord[];

  // Index pré-calculés (construits une fois, partagés entre toutes les métriques)
  issueByKey: Map<string, IssueRecord>;
  transitionsByIssue: Map<string, TransitionRecord[]>;
  transitionsByToStatus: Map<string, TransitionRecord[]>;

  // delivered : 1ère transition vers un statut team-done, par issue
  deliveredAt: Map<string, string>;

  // Population cycle-time (mutualisée) : issues avec une transition vers
  // devStartStatuses ET une livraison team-done dans la fenêtre.
  // = équivalent in-memory de fetchDeliveredTransitions + groupByIssue.
  cycleTimePopulation: CycleTimeSample[];

  // Helpers réutilisés (pas dépendants du store, exposés pour confort)
  workingDaysBetween: typeof workingDaysBetween;
  isoWeek: typeof isoWeek;

  config: MetricConfig;
}

export function buildMetricsContext(
  store: ReadStore,
  config: MetricConfig,
): MetricsContext {
  // 1. Charger issues + transitions (filtrées par excludeIssueTypes en mémoire)
  // 2. Construire les Maps d'index
  // 3. Calculer deliveredAt en parcourant transitions une fois
  // 4. Calculer cycleTimePopulation à partir de devStartStatuses + deliveredAt
  //    + cutoffDate + windowEndDate
  // ...
}
```

**Indexation** : l'utilisation de `Map<string, T[]>` est volontaire —
`groupByIssue` retourne déjà cette structure (`src/metrics/utils.ts:315-326`).
On bascule la primitive vers le contexte au lieu de la rebuilder par métrique.

**Filtrage** :

- `excludeIssueTypes` est appliqué une fois lors du chargement des issues,
  pas par chaque métrique.
- `cutoffDate` / `windowEndDate` filtrent `cycleTimePopulation` mais pas
  `transitions` (certaines métriques ont besoin de l'historique complet,
  ex : `agingWip`, `wipPerRole`, `bugBacklog`).

**Performance attendue** :

- Construction du contexte : un parcours `O(N)` sur issues + un parcours
  `O(M)` sur transitions, avec `N ≈ 10k` et `M ≈ 100k` sur KECK.
- Coût constant amorti sur les 25 métriques (au lieu de 25 requêtes SQL
  qui parcourent chacune une partie des transitions).
- Mémoire : `~100k` records × ~150 octets ≈ 15 MB. Acceptable.

## Nouvelle signature `Metric<T>`

`src/metrics/types.ts` :

```typescript
// AVANT
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}

// APRÈS
export interface Metric<T> {
  name: string;
  description: string;
  compute(ctx: MetricsContext): T;
}
```

`config` n'est plus passé séparément — il est embarqué dans le contexte.
Cela évite la situation actuelle où certaines métriques reçoivent
`config` et utilisent `db` derrière, et d'autres l'inverse.

## Helpers SQL : sort par fichier

| Helper actuel (`src/metrics/utils.ts`) | Devient |
|---|---|
| `buildDeliveredCte` | supprimé — la dérivation `deliveredAt` est faite en TypeScript par `MetricsContext` (parcours unique sur transitions, comparaison `categoryKey === "done"` ou présence dans `legacyDoneStatuses`) |
| `buildWindowFragment` | supprimé (filtre fait en mémoire par `MetricsContext`) |
| `buildExcludeIssueTypesFragment` | supprimé (filtre fait en mémoire) |
| `buildBugExclusionFragment` | supprimé (filtre fait en mémoire dans la métrique) |
| `placeholders` | supprimé (plus de SQL) |
| `fetchDeliveredTransitions` | remplacé par `ctx.cycleTimePopulation` + `ctx.transitionsByIssue` |
| `groupByIssue` | reste (utilisé pour grouper les transitions filtrées d'une métrique spécifique) |
| `workingDaysBetween` | reste (pure) |
| `isoWeek` | reste (pure) |
| `percentile` / `removeUpperOutliers` / `statsFromDays` | restent (pures) |
| `bucketize` / `getBucketLabels` / `getDefaultThresholds` | restent (pures) |
| `computeRoleDays` / `toRoleStatuses` | restent (pures) |

## Migration des 25 métriques (pattern)

`src/metrics/leadTime.ts` avant :

```typescript
compute(db: Database.Database, config: MetricConfig): LeadTimeSummary {
  const todoPh = placeholders(config.todoStatuses);
  const devStartPh = placeholders(config.devStartStatuses);
  const delivered = buildDeliveredCte(config.doneStatuses);
  // ... 30 lignes de SQL ...
  const rows = db.prepare(`...`).all(...) as { issue_key: string; ... }[];
  // ... transformation ...
}
```

Après :

```typescript
compute(ctx: MetricsContext): LeadTimeSummary {
  const { todoStatuses, devStartStatuses, doneStatuses } = ctx.config;
  const todoSet = new Set(todoStatuses);
  const devStartSet = new Set(devStartStatuses);
  const doneSet = new Set(doneStatuses);

  const issues: LeadTimeResult[] = [];
  for (const [issueKey, transitions] of ctx.transitionsByIssue) {
    const todoAt = transitions.find((t) => todoSet.has(t.toStatus))?.transitionedAt;
    const devStartAt = transitions.find((t) => devStartSet.has(t.toStatus))?.transitionedAt;
    const doneAt = ctx.deliveredAt.get(issueKey);
    if (!todoAt || !devStartAt || !doneAt) { continue; }
    if (doneAt < todoAt) { continue; }
    issues.push({
      issueKey,
      todoAt,
      resolvedAt: doneAt,
      leadTimeDays: ctx.workingDaysBetween(todoAt, doneAt),
    });
  }
  const stats = statsFromDays(issues.map((i) => i.leadTimeDays), ctx.config.excludeOutliers !== false);
  return { ...stats, issues };
}
```

Mêmes principes pour les 24 autres. La logique de filtre `cutoffDate` /
`windowEndDate` est appliquée par `MetricsContext` (ou par la métrique si
elle a besoin d'une fenêtre différente — cas de `bugBacklog`, `agingWip`).

## Migration `snapshots/compute.ts`

`backfillSnapshots(db, baseConfig)` devient
`backfillSnapshots(store: Store, baseConfig: MetricConfig): number`.
Le module construit un `MetricsContext` *par snapshot date* (avec
`windowEndDate` modulé par la date) et appelle
`metric.compute(ctx)`. L'écriture finale passe par
`store.snapshots.replaceAll(rows)` au lieu de `db.exec("DELETE ...") + INSERT`.

## Migration `report/generate.ts`

`generateReport(db, ...)` devient `generateReport(store: ReadStore, ...)`.
Le rapport ne lit que `store.snapshots.all()` + quelques lookups
(`store.issues.byKey`, `store.sprints.byId`). Aucune nouvelle requête SQL.

## Migration `sync.ts`

`sync(jiraConfig)` instancie un `SqliteStore` (via `main.ts` qui le passe en
paramètre) et utilise les méthodes `WriteStore` :

- `store.issues.upsertMany(rows)`
- `store.transitions.replaceForIssues(items)`
- `store.sprints.upsertMany(rows)`
- `store.statuses.upsertMany(rows)`
- `store.issueFieldChanges.replaceForIssues(items)`
- `store.issueSprints.replaceForIssues(items)`
- `store.appConfig.get("estimation_method")` pour détecter le changement
  d'estimation (logique métier qui passe du module `db/store.ts` à `sync.ts`).
- `store.appConfig.set("estimation_method", ...)`
- `store.syncLog.append({ syncedAt, issuesCount, projectKey })`
- `store.transaction(() => { ... })` pour grouper les écritures par batch.

## Bootstrap `main.ts`

```typescript
import { SqliteStore } from "./store/sqlite";

function openStore(config: AppConfig): Store {
  const db = openDb(config.db.path);
  return new SqliteStore(db);
}

// Dans chaque commande :
const store = openStore(config);
const metricConfig = buildMetricConfig(store, config); // prend ReadStore au lieu de Database
const ctx = buildMetricsContext(store, metricConfig);
const results = runAllMetrics(ctx); // plus de db ni config en paramètre
```

`buildMetricConfig` (actuel `main.ts:203`) prend désormais un
`ReadStore` au lieu de `Database.Database` et appelle
`store.statuses.all()` au lieu de `getDoneStatusNames(db)` /
`getAllStatuses(db)`.

`calibrateThresholds` (actuel `main.ts:331`) reste local à `main.ts`
mais lit via `store.issues.all()` puis filtre/calcule en TypeScript.
Justifié : utilisé uniquement par `autoconfig`, calcul ad-hoc sans valeur
métier réutilisable.

## Sortie helpers de `src/db/store.ts`

| Fonction actuelle | Devient |
|---|---|
| `openDb(path)` | déplacé dans `src/store/sqlite/schema.ts` |
| `migrate(db)` | déplacé dans `src/store/sqlite/schema.ts` (privé, appelé par `openDb`) |
| `upsertIssues` | privé dans `src/store/sqlite/issues.ts`, exposé via `store.issues.upsertMany` |
| `upsertSprints` | idem `sprints.ts` |
| `replaceTransitions` / `replaceAllTransitions` | idem `transitions.ts` |
| `replaceAllFieldChanges` | idem `issueFieldChanges.ts` |
| `replaceAllIssueSprints` | idem `issueSprints.ts` |
| `upsertStatuses` | idem `statuses.ts` |
| `getDoneStatusNames` | supprimé — appelants utilisent `store.statuses.all().filter(s => s.categoryKey === "done")` |
| `getAllStatuses` | remplacé par `store.statuses.all()` |
| `getLastSyncDate` | remplacé par `store.syncLog.lastByProject(projectKey)?.syncedAt ?? null` |
| `getDistinctTransitionStatuses` | remplacé par dérivation in-memory : `new Set(store.transitions.all().map(t => t.toStatus))` |
| `logSync` | remplacé par `store.syncLog.append(...)` |
| `getStoredEstimationMethod` | remplacé par `store.appConfig.get("estimation_method") ?? "time"` |
| `persistEstimationMethod` | remplacé par `store.appConfig.set("estimation_method", value)` |
| `getStoredSnapshotWindowDays` | remplacé par `store.appConfig.get("snapshot_window_days")` (parse côté appelant) |
| `persistSnapshotWindowDays` | remplacé par `store.appConfig.set("snapshot_window_days", String(days))` |

## Séquence de commits TDD attendue

~30 commits, ordonnés pour minimiser le diff par commit et préserver la
suite de tests à chaque étape :

1. **Infra** (3 commits)
   - Créer `src/store/types.ts` (interfaces vides + record types) + tests de typage.
   - Créer la suite `tests/store/contract.test.ts` (vide, prête à recevoir
     les cas de test au fur et à mesure).
   - Créer `src/store/sqlite/index.ts` avec `SqliteStore` qui ne fait rien
     (toutes les méthodes throwent).

2. **SqliteStore par sous-domaine** (~10 commits, un par fichier
   `sqlite/*.ts`) — pour chaque sous-domaine (issues, transitions, sprints,
   …) :
   - Test de contrat : insérer des données via `WriteStore`, lire via
     `ReadStore`, vérifier l'égalité.
   - Implémentation `SqliteStore` qui délègue à du SQL — réutilise
     telle-quelle la logique des fonctions actuelles de `src/db/store.ts`.

3. **`MetricsContext`** (2 commits)
   - Test : construire un contexte sur fixtures KECK réduites, vérifier
     les Maps d'index et `cycleTimePopulation` contre une référence.
   - Implémentation `buildMetricsContext` + helpers internes.

4. **Migration des 25 métriques** (~12 commits, par paquets cohérents)
   - Pour chaque paquet : adapter signature `compute(ctx)`, supprimer le
     SQL, garder le test existant qui doit continuer à passer (modulo
     le changement de fixture : le test instancie un `SqliteStore` puis
     un contexte au lieu de passer `db`).
   - Ordre suggéré : leadTime / cycleTime / leadTimeBySize / cycleTimeBySize
     (4) → throughput / bugThroughput / throughputWeighted (3) →
     wip / bugBacklog / agingWip (3) → flowEfficiency / bugCycleTime (2) →
     stageTimeBreakdown / wipPerRole / stageThroughputGap / handoffRework /
     firstTimeRight / reworkCost / scopeChange / bottleneckAnalysis /
     forecast / devTimeAllocation / leadTimeNormalized /
     cycleTimeNormalized (12).

5. **Snapshots, report, sync** (3 commits)
   - `snapshots/compute.ts` : signature `(store, config)`, plus de SQL.
   - `report/generate.ts` : signature `(store, ...)`, plus de SQL.
   - `sync.ts` : utilise `WriteStore`.

6. **Bootstrap + nettoyage** (2 commits)
   - `main.ts` : un `SqliteStore` injecté partout, `buildMetricConfig`
     prend `ReadStore`.
   - Suppression de `src/db/store.ts` (fichier vide), ajout du test
     d'architecture `tests/architecture/no-sql-in-business-logic.test.ts`.

## Tests

### Niveau 1 — Tests des métriques (existants, adaptés)

Les ~50 tests actuels sous `tests/metrics/` continuent à passer. Le seul
changement par test : remplacer `metric.compute(db, config)` par
`metric.compute(buildMetricsContext(new SqliteStore(db), config))`. Un helper
`tests/_helpers/createTestContext.ts` factorise cette plomberie.

### Niveau 2 — Contrat du Store

`tests/store/contract.test.ts` : pour chaque sous-domaine de `Store`,
écrire des données via `WriteStore`, les relire via `ReadStore`, vérifier
l'égalité champ à champ. Ces tests instancient `new SqliteStore(openDb(":memory:"))`.
Quand un futur backend sera ajouté, la même suite tournera contre lui via
un harness paramétré (factory `() => Store`). Sortie de ce ticket : la
factory n'est pas paramétrée — un seul backend, le harness l'appelle en dur.

### Niveau 3 — Snapshot test JSON

`tests/snapshots/metrics-output.test.ts` : sur la base de fixtures
`board.fake.yaml`, exécute `runAllMetrics(ctx)` et compare le JSON résultat
à un fichier de référence `tests/snapshots/__snapshots__/metrics-output.json`.
Le fichier est généré une fois (avant le refactor) et committé. Sert de
filet de sécurité contre les régressions silencieuses pendant la migration
des 25 métriques.

### Niveau 4 — Test d'architecture

`tests/architecture/no-sql-in-business-logic.test.ts` : grep sur
`src/metrics/`, `src/snapshots/`, `src/report/`, `src/sync.ts` pour les
patterns `\bdb\.prepare\b`, `\bdb\.exec\b`, `\bdb\.transaction\b`,
`from ["']better-sqlite3["']`, `\bSELECT\b`, `\bINSERT INTO\b`,
`\bDELETE FROM\b`, `\bUPDATE \w+ SET\b`. Échec si match.

## Risques et mitigation

| Risque | Mitigation |
|---|---|
| Régression silencieuse sur le calcul d'une métrique | Snapshot test JSON niveau 3 + tests existants des métriques (niveau 1) |
| Perte de perf (SQL → in-memory + index B-tree perdus) | Mutualisation `MetricsContext` (1 chargement pour 25 métriques au lieu de 25 requêtes) ; mesure timing avant/après en CI ou manuelle |
| Empreinte mémoire ~15 MB sur KECK | Mesurée en CF-05, considérée acceptable pour CLI ; à reconsidérer si rapport prod tombe en OOM |
| Refactor sync hors de portée d'origine (YAGNI flag) | Décision explicite de l'utilisateur, isolé dans son propre commit, rollback facile |
| Tests `tests/snapshots/compute049.test.ts` (récents) cassent | Adaptés en même temps que `snapshots/compute.ts` |

## Décisions ouvertes

Aucune. Toutes les décisions architecturales (option « événements bruts »,
façades séparées, `MetricsContext` partagé, périmètre total y compris sync,
un seul ticket multi-commits) ont été validées dans la phase brainstorming.

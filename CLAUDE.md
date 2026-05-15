# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding standards

**All production code follows the conventions in [`docs/coding-standards.md`](docs/coding-standards.md).** Read this file before writing or modifying any code in `src/`. Highlights:

- **TDD is mandatory** (Red → Green → Refactor) for every change: feature, bug fix, refactor with behavior change. Tests are written *before* production code, never after.
- TypeScript 6 strict, double quotes, 2-space indent, semicolons, trailing commas.
- camelCase in TS, snake_case in SQL — explicit mapping in `store/sqlite/*.ts` and `sync.ts`.
- Plugin pattern for metrics: implement `Metric<T>` (`compute(ctx: MetricsContext)`), register in `ALL_METRICS` ; pas d'accès direct à la DB — passer par `ctx.store: ReadStore` (`src/store/types.ts`) ou les vues mémoire (`ctx.cycleTimePopulation`, `ctx.transitionsByIssue`, `ctx.deliveredAt`).
- French for prose / logs / test names, English for code identifiers.
- Comments explain *why*, never *what*.

Deviations require an inline `// pourquoi` comment justifying the choice.

## Documentation structure (`docs/`)

```
docs/
├── coding-standards.md          ← conventions, TDD, layering, patterns
└── specs/
    ├── system/                  ← spec d'ensemble du produit
    │   ├── spec-fonctionnelle.md     ← user stories, règles métier globales
    │   ├── spec-technique.md         ← stack, schéma DB, architecture
    │   └── metrics-formulas.md       ← définitions mathématiques des métriques
    └── tickets/                 ← un dossier par ticket de dev
        └── <NNN>-<slug>/
            ├── description.md          ← user story + solution choisie + statut
            ├── spec-fonctionnelle.md   ← spec fonctionnelle détaillée du ticket
            ├── spec-technique.md       ← spec technique ancrée dans le code réel
            └── example-mapping.md      ← scénarios Gherkin (si règle métier non-triviale)
```

**Conventions :**

- Numérotation tickets : 3 chiffres séquentiels (`001`, `002`, …) + slug kebab-case
- Tout nouveau ticket non-trivial passe par `/ticket-spec` avant code
- `description.md` reste à jour : `Statut: à faire | en cours | livré`
- `spec-technique.md` cite des chemins `src/` réels et numéros de ligne — pas de pseudo-code abstrait
- `example-mapping.md` optionnel ; obligatoire si UI complexe ou règles métier multiples
- Spécs système (`docs/specs/system/`) décrivent l'état actuel ; mises à jour quand un ticket livré modifie un invariant

## Commands

```bash
npm run sync        # Pull Jira → SQLite (issues, transitions, sprints)
npm run metrics     # Compute and print all metrics (full history since cutoffDate)
npm run snapshots   # Backfill weekly metric_snapshots table (required before report)
npm run report      # Generate self-contained HTML report (reads metric_snapshots)
npm run refresh     # Enchaîne sync → snapshots → report (arrêt sur erreur)
npm run build       # Compile TypeScript → ./dist
npm start           # Run compiled build
```

`metrics` options: `-m <name>` (single metric), `--json`, `--include-outliers`, `-b <path>` (board config, default `./board.yaml`), `--lang <code>` (default `en`; `fr` for French output).
`report` options: `-c <path>` (config, default `./config.yaml`), `-b <path>` (board config, default `./board.yaml`), `-o <path>` (output file, default `./report.html`), `--lang <code>`.
`refresh` options: `-c <path>` (config, default `./config.yaml`), `-b <path>` (board config, default `./board.yaml`), `-o <path>` (output file, default `./report.html`), `--lang <code>`. Permet de générer des rapports distincts par squad : `npm run refresh -- -c config.keck.yaml -b board.yaml -o report.keck.html`.
`snapshots` / `validate-config` options: `-b <path>` (board config, default `./board.yaml`), `--lang <code>`.
`autoconfig` options: `-c <path>` (config path, default `./config.yaml`), `-b <path>` (board config, default `./board.yaml`), `--apply` (destructive: creates/overwrites `board.yaml` after 3s delay; backs up existing to `board.yaml.bak`), `--lang <code>`. Dry-run prints detected `metrics.estimation` as YAML snippet including calibrated `bucketThresholds` (P25/P50/P75/P90 from DB if ≥30 estimated issues; falls back to hardcoded defaults otherwise). `--apply` writes `metrics.estimation` detected from the Jira board API; preserves existing value if `board.yaml` already has `metrics.estimation`.
`list-metrics` subcommand prints all registered metric names. Accepts `--lang <code>`.

All commands accept `--lang <code>` (`en` default, `fr` for French). Unknown locale warns and falls back to `en`.

**Mode fake (sans Jira)** : ajouter `jira.mode: fake` + `jira.frozenNow: "YYYY-MM-DD"` dans `config.yaml`. Les fixtures JSON embarquées (`src/jira/fixtures/`) remplacent l'API. Output déterministe : toutes les métriques utilisent `frozenNow` comme "aujourd'hui", le forecast Monte Carlo utilise un PRNG seedé. Exemple :
```bash
npm run refresh -- -c config.fake.yaml -b board.fake.yaml -o report.fake.html
```

No test or lint commands defined.

## Architecture

TypeScript CLI. Data flow:

```
Jira REST API v2 (ou fixtures JSON) → SQLite (WAL) → metric computations → stdout / HTML report
```

**Layers** (`src/`):
- `main.ts` — Commander.js CLI; routes `sync` / `metrics` / `snapshots` / `report` / `refresh` / `autoconfig` / `list-metrics`; instancie `SqliteStore` per-command et propage la façade `Store`/`ReadStore` aux helpers internes (`buildMetricConfig`, `calibrateThresholds`, `enrichWithLegacyStatuses`); aucun import direct de `src/db/store`; exports `inferBoardColumns()`, `renderBoardColumnsYaml()`, `enrichWithLegacyStatuses()`, `mergeColumns()`, `buildUnresolvableComment()`, `inferEstimationConfig()`, `buildEstimationWarnings()`, `loadJiraConfig()`, `loadBoardConfig()`, `loadConfigs()`, `InferredColumn`, `BoardColumn`, `RoleType`, `JiraFileConfig`, `BoardFileConfig`; bootstrap `initClock`/`initRandom` si `jira.mode=fake`
- `sync.ts` — fetches sprints + issues (with changelog), upserts to DB; `replaceTransitions` per issue; incremental mode via `getLastSyncDate()` (JQL `updated >= "<date>"` filter when prior sync exists)
- `jira/clientFactory.ts` — `JiraClientLike` interface + `createJiraClient(config)` factory; retourne `JiraClient` (real) ou `FakeJiraClient` (fake) selon `jira.mode`
- `jira/client.ts` — Axios + 200ms sleep between pages
- `jira/fakeClient.ts` — charge `statuses.json` / `sprints.json` / `issues.json` / `boardConfig.json` depuis `src/jira/fixtures/` (ou `jira.fixturesPath`)
- `clock.ts` — `now()` injectable; figée à `jira.frozenNow` en mode fake; utilisée par toutes les métriques sensibles à "aujourd'hui"
- `random.ts` — `random()` injectable; Mulberry32 seedé par `jira.frozenNow` en mode fake; utilisée par `forecast` Monte Carlo
- `store/sqlite/` — `SqliteStore` façade (better-sqlite3, WAL, atomic transactions) ; implémente `Store = ReadStore & WriteStore` (sub-namespaces `issues` / `transitions` / `sprints` / `statuses` / `issueFieldChanges` / `issueSprints` / `snapshots` / `appConfig` / `syncLog`) ; `openDb` re-exporté depuis `./store/sqlite/schema`
- `metrics/` — plugin registry: implement `Metric<T>`, register in `ALL_METRICS` (`index.ts`)
- `snapshots/compute.ts` — backfills `metric_snapshots` weekly; used by report
- `report/generate.ts` — reads `metric_snapshots`, renders standalone HTML with Chart.js

## Key invariants

**Population consistency**: `cycle-time` (and its by-size / normalized variants), `flow-efficiency`, `aging-wip`, `dev-time-allocation`, et la vue partagée `MetricsContext.cycleTimePopulation` filtrent aux issues ayant une transition vers `devStartStatuses`. The previous `todoStatuses` EXISTS filter was removed — analysis showed only 1% of issues skip TODO on the target board, making the constraint have negligible benefit while complicating the population definition. `lead-time` still requires `todoStatuses` (it is the measurement start point, not a filter).

**Duration unit**: all durations in **working days** (Mon–Fri) via `workingDaysBetween()` in `utils.ts`. Snapshot window boundaries (`cutoffDate ± N days`) stay in calendar days.

**Delivery = team-done (NOT `resolutiondate`)**: every duration metric (lead/cycle/normalized/by-size/bug-cycle/flow/aging) and every debit metric (throughput/bug-throughput/throughput-weighted/forecast) ends at `done_at` = first transition to a status whose `statusCategory.key='done'` (or that appears in `board.legacyDoneStatuses` for legacy renamed statuses absent from the API). Centralisé dans `MetricsContext.deliveredAt` (cf. `src/metrics/context.ts:62-66`), construit à partir de `config.doneStatuses`. Rationale: on KECK, "À valider" carries `statusCategory=done` and is delivery from the team's perspective; tickets routinely sit there post-dev waiting on PO validation. Using `resolutiondate` would over-count that PO queue. The bulk-close 2025-10-25 resilience now comes from `cutoffDate >= 2025-11-01`, not from the resolutiondate property.

**Status taxonomy auto-derivation**: `sync` calls `/rest/api/2/status` and stores into table `statuses (name, category_key, category_name)`. At runtime, `deriveStatusConfig()` builds status lists from `board.columns`, then `buildMetricConfig` (in `main.ts`) strips any status whose `category_key='done'` (or that's in `board.legacyDoneStatuses`) from `inProgressStatuses` / `activeStatuses` / `queueStatuses`. `board.legacyDoneStatuses` is the fallback for legacy renamed statuses (e.g. "To Be Validated", "Delivred", "DELIVERED") that exist in `transitions` history but no longer appear in the live API response. A startup warning lists every status that gets stripped.

**Snapshot windows** (in `snapshots/compute.ts`):
- Duration metrics (lead/cycle/normalized/bug-cycle/flow-efficiency): 30-day rolling window
- Debit metrics (throughput, bug-throughput, throughput-weighted): 7-day window
- By-size metrics (lead-time-by-size, cycle-time-by-size) and `aging-wip`: cumulative from global `cutoffDate` — matches `npm run metrics` output
- `wip`: reconstructed historically from transitions, no sprint scoping
- `forecast`: skipped in snapshots (Monte Carlo, non-deterministic; computed live in report)

## Database schema

- `issues` — current snapshot; `resolved_at` = Jira `resolutiondate` (kept for audit; no longer used by metrics); `story_points REAL` (story-points + numeric methods); `size_label TEXT` (t-shirt method)
- `transitions` — full status history; **source of truth for all duration & debit metrics** via `done_at`; indexed on `issue_key`, `to_status`, `transitioned_at`
- `statuses` — `(name, category_key, category_name)`; populated by `sync` from `/rest/api/2/status`; drives done-status detection at runtime
- `sprints` — `current_sprint_id` on issues holds only the current active sprint
- `sync_log` — audit trail
- `issue_field_changes` — changelog des champs métier (`description`, `summary`, `Story Points`, `Sprint`); replace-all par issue à chaque sync; `from_value`/`to_value` nullable; indexé sur `issue_key`, `field_name`, `changed_at`
- `issue_sprints` — table de jonction `(issue_key, sprint_id)` peuplée depuis `customfield_10020` à chaque sync (replace-all par issue); représente l'appartenance historique complète d'une issue à ses sprints (inclut les issues créées directement dans un sprint, sans changelog Sprint); dénominateur de `scope-change-rate`; indexé sur `issue_key` et `sprint_id`
- `metric_snapshots` — long format `(snapshot_date, metric_name, bucket, stat, value)`; populated by `npm run snapshots`; read by `npm run report`
- `app_config` — clé/valeur applicative persistée entre syncs; utilisée pour détecter un changement de `metrics.estimation.method` et forcer un full resync automatique

## Configuration (`config.yaml` + `board.yaml`)

Config is split into two files: `config.yaml` (gitignored, secrets: `jira.*` + `db.*`) and `board.yaml` (commitable: `board.*` + `metrics.*`). `jira.name` (optional) sets the squad display name in the report header; falls back to `projectKey` if absent. Use `config.example.yaml` and `board.example.yaml` as templates. `autoconfig --apply` generates `board.yaml`.

**Auth** : deux modes mutuellement exclusifs dans `config.yaml` :
- **Basic** (Cloud ou Server) : `jira.email` + `jira.apiToken` requis → `Authorization: Basic`
- **PAT** (Server ≥ 8.14 ou Data Center) : `jira.personalAccessToken` présent et non vide → `Authorization: Bearer`; `email`/`apiToken` ignorés
- Si ni PAT ni Basic complet → `loadJiraConfig` affiche une erreur et fait `process.exit(1)`

**Mode fake** : champs additionnels sous `jira:` dans `config.yaml` :
- `mode: "fake"` — active le connecteur fake (default `"real"`)
- `frozenNow: "2026-01-15"` — obligatoire si `mode: fake`; fige l'horloge pour output déterministe
- `fixturesPath: "./src/jira/fixtures"` — optionnel; override le path des fixtures JSON embarquées

Voir `config.fake.yaml` + `board.fake.yaml` comme exemples complets.

Board is defined as an ordered list of columns under `board.columns`. Each column has a `type` (`todo` | `active` | `queue` | `done`), an optional `devStart: true` flag, an optional `role` (`"dev" | "qa" | "po"`) flag, and a list of `statuses`. Status lists for metrics are derived automatically by `deriveStatusConfig()` in `main.ts`:

- columns `type: todo` → `todoStatuses` → start of lead time
- columns `devStart: true` → `devStartStatuses` → start of cycle time
- columns `type: active` ∪ `type: queue` → `inProgressStatuses` → WIP count (filtered against done-category at runtime)
- columns `type: active` → `activeStatuses` → "touch time" for `flow-efficiency`
- columns `type: queue` → `queueStatuses` → "queue time" for `flow-efficiency`
- columns `type: done` ∪ `board.legacyDoneStatuses` → `doneStatuses` → fallback for legacy renamed statuses absent from `/rest/api/2/status`; unioned with DB-derived done set
- columns `role: dev` → `devStatuses`; `role: qa` → `qaStatuses`; `role: po` → `poStatuses` → fondation métriques role-aware (tickets 021–025); colonnes sans `role` ignorées silencieusement
- `metrics.cutoffDate` → global lower bound (issues delivered before are ignored)
- `metrics.bugIssueTypes` → routed to BUG bucket; excluded from normalized/weighted metrics
- `metrics.healthThresholds` → optional KPI health signals in the report; `mode: "static" | "dynamic"` (default `"static"`); in static mode each key maps to `{ warn, crit }` pair; in dynamic mode thresholds are computed from the last `windowWeeks` (default 12) weeks of `metric_snapshots` — `warn=P50`, `crit=P85` for lower-better metrics, `crit=P15` for throughput; minimum 4 weeks required or signal is absent; explicit `{ warn, crit }` entries override dynamic values per-KPI; keys: `leadTimeMedianDays`, `cycleTimeMedianDays`, `throughputWeekly` (higher=better), `wipCount`, `bugCycleTimeMedianDays`, `bugRatio`; implemented in `resolveThresholds()` + `computeDynamicThresholds()` in `src/report/generate.ts`
- `metrics.snapshotWindowDays` → fenêtre glissante en jours calendaires pour les snapshots de métriques de durée (lead-time, cycle-time, bug-cycle-time, flow-efficiency, stage-time-breakdown, stage-throughput-gap, bottleneck-analysis). Défaut : 30. Ignoré par les métriques hebdomadaires (throughput, bug-throughput…) et cumulatives (by-size, aging-wip, rework-cost). Doit être un entier > 0 ; > 365 déclenche un avertissement. Un changement entre deux exécutions de `npm run snapshots` déclenche un recalcul intégral (détection via `app_config`). Validé dans `loadBoardConfig()`.
- `metrics.estimation` → section optionnelle déclarant la méthode d'estimation : `method` (`time` | `story-points` | `numeric` | `t-shirt` | `none`), `jiraField` (obligatoire pour `numeric` et `t-shirt`; implicite pour `time`=`timeoriginalestimate` et `story-points`=`customfield_10016`), `bucketThresholds` (`{xs,s,m,l}` numérique; obligatoire pour `numeric`; optionnel pour `time` et `story-points` avec seuils par défaut). Méthodes `numeric`/`story-points` alimentent `issues.story_points`; `t-shirt` alimente `issues.size_label`. Changement de méthode entre deux syncs force un full resync automatique (détection via `app_config`). Validation au démarrage via `validateEstimationConfig()` dans `loadBoardConfig()`
- `report.title` → replaces "Rapport Lean — {projectKey}" in HTML `<title>` and header
- `report.logoUrl` → local path (resolved from `board.yaml` dir, embedded as base64 data URI) or http(s) URL; supported extensions: `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`; missing file throws error; unknown extension warns and ignores
- `report.fontUrl` → replaces IBM Plex Google Fonts `<link>` (Chart.js font unchanged)
- `report.customCssPath` → path to `.css` file (resolved from `board.yaml` dir), injected in a second `<style>` block after the default styles (normal cascade, no `!important` needed); missing file throws error
- `report.excludeTabs` → list of tabs to hide from nav + content; valid values: `delivery`, `quality`, `roles`, `forecast`, `advanced`; unknown values warn and are ignored; KPIs and "À traiter" sections always present
- `report.templatePath` → path to a custom Handlebars `.hbs` template (resolved from `board.yaml` dir); replaces the built-in HTML renderer entirely; use `npm run report -- --export-template <dir>` to export the default template as a starting point; template receives a `TemplateContext` object documented in `context.schema.json`

## Metric catalog

| Name | Output | Period |
|---|---|---|
| `lead-time` / `-by-size` / `-normalized` | DurationStats | TODO entry → team-done |
| `cycle-time` / `-by-size` / `-normalized` | DurationStats | dev start → team-done |
| `bug-cycle-time` | DurationStats | dev start → team-done (bugs only) |
| `throughput` / `bug-throughput` | byWeek + avgPerWeek | weekly count of team-done deliveries |
| `throughput-weighted` | byWeek (estimatedDays) + unit ("j-h"\|"SP"\|"pts") + disabled | weekly sum of estimated units delivered; unit derived from estimation.method; disabled for t-shirt/none |
| `wip` | currentWip + issueKeys | sprint-scoped active WIP |
| `flow-efficiency` | aggregate / median / P15 | active / (active+queue) over cycle-time window |
| `aging-wip` | per-issue ages + risk classification | current items vs historical cycle-time P50/P85/P95 |
| `forecast` | byHorizon (1/2/4/8 weeks) | Monte Carlo on last 12 weeks of throughput; outputs P15/P50/P85/P95 |
| `dev-time-allocation` | byWeek (featureDays/bugDays/bugRatio) + avgBugRatio | weekly cycle-time split features vs bugs; includes WIP (done_at fictif = today); avgBugRatio weighted by volume |
| `bug-backlog` | openCount / netFlow / created / closed | point-in-time open bugs + weekly net flow (closed − created) |
| `stage-time-breakdown` | count + byRole {dev,qa,po}: DurationStats + avgShareByRole {dev,qa,po} | temps médian par rôle sur population cycle-time; requiert `role:` sur colonnes board.yaml |
| `wip-per-role` | byRole {dev,qa,po}: {count, issueKeys} | WIP global par rôle (sans scoping sprint); snapshot point-in-time via `computeHistoricWipPerRole` |
| `stage-throughput-gap` | byWeek [{devIn,devOut,devNet,qaIn,...}] + avgNetByRole {dev,qa,po} | entrées/sorties par rôle par semaine ISO; fenêtre 30j (snapshot) ou complète (CLI) |
| `handoff-rework` | count + reworkRatio + avgReworks + byReworkType {qaToDev,poToQa,poDev} | % tickets avec retour arrière entre rôles; population cycle-time; rolling 30j |
| `first-time-right` | count + ftrByRole {dev,qa,po}: {eligible,firstTimeRight,ftrRate,avgPasses} | % tickets traversant chaque rôle en 1 seul passage; population cycle-time; rolling 30j |
| `rework-cost` | count + reworkedCount + reworkRatio + totalReworkDays + avgReworkDaysPerReworkedTicket + reworkCostRatio + byWeek[] + bySprint[] | coût jours-ouvrés des passes rework (2e passe ou + même rôle); statuts hors rôle réinitialisent le contexte; population cycle-time; rolling 30j |
| `scope-change-rate` | totalIssues + changedIssues + changeRatio + bySprint (incl. issueDetails[]) + changedIssueKeys | issues dont la description ou le résumé a changé significativement après entrée en sprint; seuil similarité 0.85; non snapshotté |
| `bottleneck-analysis` | count + primaryBottleneck + primaryColumn + recommendation + byRole {dev,qa,po}: {score,rank,dominantSignal,dominantColumn,signals} + byColumn[]: {column,role,medianDays,count} | score composite 0–1 par rôle synthétisant 4 signaux (stageTime, avgNetFlow, reworkInbound, ftrPenalty); identifie le stage prioritaire selon Theory of Constraints; dominantColumn = nom de colonne board.yaml avec médiane la plus haute dans le rôle (tiebreak alphabétique); plusieurs statuts d'une même colonne sont poolés avant calcul de la médiane; byColumn trié dev→qa→po puis médiane décroissante + tiebreak alphabétique |

## Adding a metric

1. Create `src/metrics/<name>.ts` implementing `Metric<T>` ; la fonction `compute(ctx: MetricsContext)` reçoit un contexte pré-calculé. Pas d'accès direct à `Database` ni de SQL : tout passe par `ctx.store: ReadStore` (façade `src/store/types.ts`) ou les vues mémoire (`ctx.cycleTimePopulation`, `ctx.transitionsByIssue`, `ctx.deliveredAt`, `ctx.issueByKey`, `ctx.transitionsByToStatus`).
2. Pour les métriques de durée jusqu'à livraison : ne jamais utiliser `issues.resolved_at`. La date de livraison est `ctx.deliveredAt.get(issueKey)` (centralisée dans `buildMetricsContext`, basée sur `config.doneStatuses` dérivé de `board.columns` + `board.legacyDoneStatuses`).
2b. Pour la population cycle-time : itérer `ctx.cycleTimePopulation` (déjà filtrée par `excludeIssueTypes` et bornée à `cutoffDate`). Pour les transitions d'une issue, utiliser `ctx.transitionsByIssue.get(issueKey)`. Pour le breakdown par rôle, utiliser `toRoleStatuses(config)` (dans `utils.ts`) pour récupérer `{devStatuses, qaStatuses, poStatuses}` non-optionnels, puis itérer les transitions de chaque sample en classant par rôle (cf. `stageTimeBreakdown.ts:55-90` comme référence).
3. Import and push into `ALL_METRICS` in `src/metrics/index.ts`
4. Result shape determines how `snapshots/compute.ts` extracts stats. Recognized shapes: `buckets` (Record<SizeBucket, DurationStats>), `aggregateFlowEfficiency` (flow-efficiency-like), `riskCounts` (aging-wip-like), `avgDays` (DurationStats), `openCount` (bug-backlog-like), `avgBugRatio` (dev-time-allocation-like), `avgShareByRole` (stage-time-breakdown-like; discriminator précis pour ne pas capturer `byRole` de wip-per-role), `primaryBottleneck` (bottleneck-analysis-like; **doit précéder `byRole`** car `BottleneckAnalysisResult` contient aussi `byRole`), `byRole` (wip-per-role-like; discriminé après `avgShareByRole` et `primaryBottleneck`), `byWeek` (debit), `totalReworkDays` (rework-cost-like; **doit précéder `reworkRatio` et `byWeek`** car `ReworkCostResult` contient les deux), `reworkRatio` (handoff-rework-like), `ftrByRole` (first-time-right-like), `avgNetByRole` (stage-throughput-gap-like). WIP par rôle est géré séparément via `computeHistoricWipPerRole` (hors `extractStats`). Other shapes are silently skipped — add an explicit `extractStats` branch if the metric needs persistent history.
5. If the metric is non-deterministic (e.g. Monte Carlo) or shouldn't be back-filled, add an explicit skip in `snapshots/compute.ts` (see `forecast`).

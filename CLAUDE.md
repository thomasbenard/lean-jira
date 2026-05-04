# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding standards

**All production code follows the conventions in [`docs/coding-standards.md`](docs/coding-standards.md).** Read this file before writing or modifying any code in `src/`. Highlights:

- **TDD is mandatory** (Red → Green → Refactor) for every change: feature, bug fix, refactor with behavior change. Tests are written *before* production code, never after.
- TypeScript 6 strict, double quotes, 2-space indent, semicolons, trailing commas.
- camelCase in TS, snake_case in SQL — explicit mapping in `db/store.ts` and `sync.ts`.
- Plugin pattern for metrics: implement `Metric<T>`, register in `ALL_METRICS`, use `buildDeliveredCte()` for delivery endpoints.
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

`metrics` options: `-m <name>` (single metric), `--json`, `--include-outliers`, `-b <path>` (board config, default `./board.yaml`).
`report` option: `-o <path>` (output file, default `./report.html`), `-b <path>` (board config, default `./board.yaml`).
`snapshots` / `validate-config` options: `-b <path>` (board config, default `./board.yaml`).
`autoconfig` options: `-c <path>` (config path, default `./config.yaml`), `-b <path>` (board config, default `./board.yaml`), `--apply` (destructive: creates/overwrites `board.yaml` after 3s delay; backs up existing to `board.yaml.bak`).
`list-metrics` subcommand prints all registered metric names.

No test or lint commands defined.

## Architecture

TypeScript CLI. Data flow:

```
Jira REST API v2 → SQLite (WAL) → metric computations → stdout / HTML report
```

**Layers** (`src/`):
- `main.ts` — Commander.js CLI; routes `sync` / `metrics` / `snapshots` / `report` / `autoconfig` / `list-metrics`; exports `inferBoardColumns()`, `renderBoardColumnsYaml()`, `enrichWithLegacyStatuses()`, `mergeColumns()`, `buildUnresolvableComment()`, `loadJiraConfig()`, `loadBoardConfig()`, `loadConfigs()`, `InferredColumn`, `BoardColumn`, `RoleType`, `JiraFileConfig`, `BoardFileConfig`
- `sync.ts` — fetches sprints + issues (with changelog), upserts to DB; `replaceTransitions` per issue; incremental mode via `getLastSyncDate()` (JQL `updated >= "<date>"` filter when prior sync exists)
- `jira/client.ts` — Axios + 200ms sleep between pages
- `db/store.ts` — better-sqlite3; WAL; atomic transactions
- `metrics/` — plugin registry: implement `Metric<T>`, register in `ALL_METRICS` (`index.ts`)
- `snapshots/compute.ts` — backfills `metric_snapshots` weekly; used by report
- `report/generate.ts` — reads `metric_snapshots`, renders standalone HTML with Chart.js

## Key invariants

**Population consistency**: `lead-time` and `cycle-time` (and their by-size / normalized variants) filter to issues that have **both** a `todoStatuses` transition **and** a `devStartStatuses` transition. This guarantees `lead_time ≥ cycle_time` per issue and makes percentiles comparable. `bug-cycle-time` is exempt (bugs often skip TODO).

**Duration unit**: all durations in **working days** (Mon–Fri) via `workingDaysBetween()` in `utils.ts`. Snapshot window boundaries (`cutoffDate ± N days`) stay in calendar days.

**Delivery = team-done (NOT `resolutiondate`)**: every duration metric (lead/cycle/normalized/by-size/bug-cycle/flow/aging) and every debit metric (throughput/bug-throughput/throughput-weighted/forecast) ends at `done_at` = first transition to a status whose `statusCategory.key='done'` (or that appears in `board.legacyDoneStatuses` for legacy renamed statuses absent from the API). Centralized in `buildDeliveredCte(doneStatuses)` in `utils.ts`. Rationale: on KECK, "À valider" carries `statusCategory=done` and is delivery from the team's perspective; tickets routinely sit there post-dev waiting on PO validation. Using `resolutiondate` would over-count that PO queue. The bulk-close 2025-10-25 resilience now comes from `cutoffDate >= 2025-11-01`, not from the resolutiondate property.

**Status taxonomy auto-derivation**: `sync` calls `/rest/api/2/status` and stores into table `statuses (name, category_key, category_name)`. At runtime, `deriveStatusConfig()` builds status lists from `board.columns`, then `buildMetricConfig` (in `main.ts`) strips any status whose `category_key='done'` (or that's in `board.legacyDoneStatuses`) from `inProgressStatuses` / `activeStatuses` / `queueStatuses`. `board.legacyDoneStatuses` is the fallback for legacy renamed statuses (e.g. "To Be Validated", "Delivred", "DELIVERED") that exist in `transitions` history but no longer appear in the live API response. A startup warning lists every status that gets stripped.

**Snapshot windows** (in `snapshots/compute.ts`):
- Duration metrics (lead/cycle/normalized/bug-cycle/flow-efficiency): 30-day rolling window
- Debit metrics (throughput, bug-throughput, throughput-weighted): 7-day window
- By-size metrics (lead-time-by-size, cycle-time-by-size) and `aging-wip`: cumulative from global `cutoffDate` — matches `npm run metrics` output
- `wip`: reconstructed historically from transitions, no sprint scoping
- `forecast`: skipped in snapshots (Monte Carlo, non-deterministic; computed live in report)

## Database schema

- `issues` — current snapshot; `resolved_at` = Jira `resolutiondate` (kept for audit; no longer used by metrics)
- `transitions` — full status history; **source of truth for all duration & debit metrics** via `done_at`; indexed on `issue_key`, `to_status`, `transitioned_at`
- `statuses` — `(name, category_key, category_name)`; populated by `sync` from `/rest/api/2/status`; drives done-status detection at runtime
- `sprints` — `current_sprint_id` on issues holds only the current active sprint
- `sync_log` — audit trail
- `metric_snapshots` — long format `(snapshot_date, metric_name, bucket, stat, value)`; populated by `npm run snapshots`; read by `npm run report`

## Configuration (`config.yaml` + `board.yaml`)

Config is split into two files: `config.yaml` (gitignored, secrets: `jira.*` + `db.*`) and `board.yaml` (commitable: `board.*` + `metrics.*`). Use `config.example.yaml` and `board.example.yaml` as templates. `autoconfig --apply` generates `board.yaml`.

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
- `metrics.healthThresholds` → optional KPI health signals in the report; each key maps to `{ warn, crit }` pair; absent = no signal; keys: `leadTimeMedianDays`, `cycleTimeMedianDays`, `throughputWeekly` (higher=better), `wipCount`, `bugCycleTimeMedianDays`, `bugRatio`

## Metric catalog

| Name | Output | Period |
|---|---|---|
| `lead-time` / `-by-size` / `-normalized` | DurationStats | TODO entry → team-done |
| `cycle-time` / `-by-size` / `-normalized` | DurationStats | dev start → team-done |
| `bug-cycle-time` | DurationStats | dev start → team-done (bugs only) |
| `throughput` / `bug-throughput` | byWeek + avgPerWeek | weekly count of team-done deliveries |
| `throughput-weighted` | byWeek (estimatedDays) | weekly sum of estimated person-days delivered |
| `wip` | currentWip + issueKeys | sprint-scoped active WIP |
| `flow-efficiency` | aggregate / median / P15 | active / (active+queue) over cycle-time window |
| `aging-wip` | per-issue ages + risk classification | current items vs historical cycle-time P50/P85/P95 |
| `forecast` | byHorizon (1/2/4/8 weeks) | Monte Carlo on last 12 weeks of throughput; outputs P15/P50/P85/P95 |
| `dev-time-allocation` | byWeek (featureDays/bugDays/bugRatio) + avgBugRatio | weekly cycle-time split features vs bugs; includes WIP (done_at fictif = today); avgBugRatio weighted by volume |
| `bug-backlog` | openCount / netFlow / created / closed | point-in-time open bugs + weekly net flow (closed − created) |
| `stage-time-breakdown` | count + byRole {dev,qa,po}: DurationStats + avgShareByRole {dev,qa,po} | temps médian par rôle sur population cycle-time; requiert `role:` sur colonnes board.yaml |

## Adding a metric

1. Create `src/metrics/<name>.ts` implementing `Metric<T>`
2. If the metric measures duration to delivery, build SQL with `buildDeliveredCte(config.doneStatuses)` from `utils.ts` — never use `issues.resolved_at` as the endpoint (`config.doneStatuses` is passed from `MetricConfig`, itself derived from `board.columns` + `board.legacyDoneStatuses`)
2b. If the metric needs per-issue transitions for the cycle-time population, use `fetchDeliveredTransitions(db, config)` + `groupByIssue()` from `utils.ts` instead of duplicating the query. For role-based time breakdown, use `computeRoleDays(transitions, done_at, toRoleStatuses(config))` — `toRoleStatuses` coalesces the optional `devStatuses/qaStatuses/poStatuses` from `MetricConfig` to non-optional arrays.
3. Import and push into `ALL_METRICS` in `src/metrics/index.ts`
4. Result shape determines how `snapshots/compute.ts` extracts stats. Recognized shapes: `buckets` (Record<SizeBucket, DurationStats>), `aggregateFlowEfficiency` (flow-efficiency-like), `riskCounts` (aging-wip-like), `avgDays` (DurationStats), `openCount` (bug-backlog-like), `avgBugRatio` (dev-time-allocation-like), `byRole` (stage-time-breakdown-like), `byWeek` (debit). Other shapes are silently skipped — add an explicit `extractStats` branch if the metric needs persistent history.
5. If the metric is non-deterministic (e.g. Monte Carlo) or shouldn't be back-filled, add an explicit skip in `snapshots/compute.ts` (see `forecast`).

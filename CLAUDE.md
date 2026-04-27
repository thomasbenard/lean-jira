# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run sync        # Pull Jira → SQLite (issues, transitions, sprints)
npm run metrics     # Compute and print all metrics (full history since cutoffDate)
npm run snapshots   # Backfill weekly metric_snapshots table (required before report)
npm run report      # Generate self-contained HTML report (reads metric_snapshots)
npm run build       # Compile TypeScript → ./dist
npm start           # Run compiled build
```

`metrics` options: `-m <name>` (single metric), `--json`, `--include-outliers`.
`report` option: `-o <path>` (output file, default `./report.html`).
`list-metrics` subcommand prints all registered metric names.

No test or lint commands defined.

## Architecture

TypeScript CLI. Data flow:

```
Jira REST API v2 → SQLite (WAL) → metric computations → stdout / HTML report
```

**Layers** (`src/`):
- `main.ts` — Commander.js CLI; routes `sync` / `metrics` / `snapshots` / `report` / `list-metrics`
- `sync.ts` — fetches sprints + issues (with changelog), upserts to DB; `replaceTransitions` per issue
- `jira/client.ts` — Axios + 200ms sleep between pages
- `db/store.ts` — better-sqlite3; WAL; atomic transactions
- `metrics/` — plugin registry: implement `Metric<T>`, register in `ALL_METRICS` (`index.ts`)
- `snapshots/compute.ts` — backfills `metric_snapshots` weekly; used by report
- `report/generate.ts` — reads `metric_snapshots`, renders standalone HTML with Chart.js

## Key invariants

**Population consistency**: `lead-time` and `cycle-time` (and their by-size / normalized variants) filter to issues that have **both** a `todoStatuses` transition **and** a `devStartStatuses` transition. This guarantees `lead_time ≥ cycle_time` per issue and makes percentiles comparable. `bug-cycle-time` is exempt (bugs often skip TODO).

**Duration unit**: all durations in **working days** (Mon–Fri) via `workingDaysBetween()` in `utils.ts`. Snapshot window boundaries (`cutoffDate ± N days`) stay in calendar days.

**`resolved_at` source**: always the Jira `resolutiondate` field, never inferred from transitions. Bulk-closes (transitions to Done in batch) don't affect `resolutiondate`, so this is robust.

**Snapshot windows** (in `snapshots/compute.ts`):
- Duration metrics (lead/cycle/normalized/bug-cycle): 30-day rolling window
- Debit metrics (throughput, bug-throughput, throughput-weighted): 7-day window
- By-size metrics (lead-time-by-size, cycle-time-by-size): cumulative from `cutoffDate` — matches `npm run metrics` output
- WIP: reconstructed historically from transitions, no sprint scoping

## Database schema

- `issues` — current snapshot; `resolved_at` = Jira `resolutiondate`
- `transitions` — full status history; **source of truth for all duration metrics**; indexed on `issue_key`, `to_status`, `transitioned_at`
- `sprints` — `current_sprint_id` on issues holds only the current active sprint
- `sync_log` — audit trail
- `metric_snapshots` — long format `(snapshot_date, metric_name, bucket, stat, value)`; populated by `npm run snapshots`; read by `npm run report`

## Configuration (`config.yaml`)

Status bucket names drive metric boundaries:
- `todoStatuses` → start of lead time
- `devStartStatuses` → start of cycle time
- `inProgressStatuses` → WIP count
- `metrics.cutoffDate` → global lower bound (issues resolved before are ignored)
- `metrics.bugIssueTypes` → routed to BUG bucket; excluded from normalized/weighted metrics

## Adding a metric

1. Create `src/metrics/<name>.ts` implementing `Metric<T>`
2. Import and push into `ALL_METRICS` in `src/metrics/index.ts`
3. If it produces `DurationStats`, `byWeek`, or bucket output, `snapshots/compute.ts` picks it up automatically via `extractStats`

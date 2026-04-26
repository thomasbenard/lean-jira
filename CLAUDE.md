# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run sync        # Sync Jira issues + transitions into local SQLite DB
npm run metrics     # Compute and print Lean metrics
npm run build       # Compile TypeScript → ./dist
npm start           # Run compiled build
```

No test or lint commands defined.

## Architecture

TypeScript CLI tool that pulls Jira Kanban data and computes Lean flow metrics.

**Data flow**: Jira Server API → local SQLite DB → metric computations → stdout

**Layers**:
- `src/main.ts` — Commander.js CLI, routes `sync` / `metrics` commands
- `src/sync.ts` — Jira pagination + issue/transition upsert orchestration
- `src/jira/client.ts` — Axios HTTP client for Jira Server REST API v2; 200ms sleep between pages
- `src/db/store.ts` — better-sqlite3; WAL mode; transactions for atomicity
- `src/metrics/` — plugin registry pattern: add metric by implementing `Metric<T>` and registering in `ALL_METRICS` (index.ts)

**Database** (schema.sql):
- `issues` — current state snapshot
- `transitions` — full status history; **source of truth for all metrics**
- `sync_log` — audit trail

**Configuration** (config.yaml):
- Jira credentials (URL, email, API token, project key)
- Kanban status names for "In Progress" and "Done" buckets — drives metric boundaries
- SQLite DB file path

**Metrics computed**: lead time, cycle time, weekly throughput (8-week rolling avg), WIP.
# lean-jira

> 🇫🇷 [Version française](README.fr.md)

CLI that syncs a Jira Kanban board, computes Lean flow metrics and generates an
interactive HTML report with time trends.

**Use case**: Agile/Kanban team that wants data-driven management without depending
on a third-party BI tool.

---

## What it produces

- **Flow metrics**: lead time, cycle time, throughput, WIP, flow efficiency, aging WIP, Monte Carlo forecast
- **Quality metrics**: bug cycle time, bug ratio, bug backlog, dev/bug allocation
- **Role-aware metrics**: time per role (dev/QA/PO), WIP per role, flow gaps, rework rate, first-time-right
- **Standalone HTML report**: Chart.js trend graphs, KPI health signals, forecast, clickable Jira links — no server required

---

## Prerequisites

- Node.js 18+
- Jira API token (Basic auth or Atlassian Cloud via gateway)
- Read access to a Jira project with a Kanban board

---

## Installation

```bash
git clone <repo>
cd lean-jira
npm install
```

---

## Configuration

Configuration is split into two files:

| File | Role | Versionable |
|---|---|---|
| `config.yaml` | Jira secrets + DB path | No (gitignored) |
| `board.yaml` | Board definition + metrics | Yes |

> For a complete step-by-step guide (auth, board, validation, troubleshooting): **[→ Configuration guide](docs/configuration.md)**

### 1. `config.yaml`

```bash
cp config.example.yaml config.yaml
```

```yaml
jira:
  baseUrl: "https://your-company.atlassian.net"
  email: "you@company.com"
  apiToken: "YOUR_API_TOKEN"   # Jira → Profile → Security → Create API token
  projectKey: "PROJ"
  boardId: 42                  # Visible in the Jira board URL
  name: "My Squad"             # Optional — shown in the report header

db:
  path: "./lean-jira.db"
```

> **Atlassian Cloud with custom domain**: if Basic auth is blocked, use the Atlassian gateway:
> ```yaml
> baseUrl: "https://api.atlassian.com/ex/jira/<cloudId>/"
> frontendUrl: "https://your-company.atlassian.net"   # required here, used for report links
> ```
> Retrieve `cloudId` via `GET https://<your-domain>/_edge/tenant_info`.

### 2. `board.yaml`

**Option A — auto-generation from the Jira API** (recommended to get started):

```bash
npm run autoconfig                   # Prints inferred YAML to stdout (dry-run)
npm run autoconfig -- --apply        # Writes board.yaml (backup → board.yaml.bak if exists)
```

`autoconfig` queries the Jira API directly and does not need a prior `sync`. If a SQLite
database already exists, legacy renamed statuses (present in transition history but absent
from the current API) are automatically added as `legacyStatuses`. To benefit from this
enrichment on a fresh install, run `sync` first then re-run `autoconfig --apply`.

`autoconfig` infers the type of each intermediate column: `queue` if the name contains a
known keyword (review, validation, QA, staging, approval…), otherwise `active`. `devStart: true`
is set on the first `active` column. The estimation method (`metrics.estimation`) is detected
from the field configured on the Jira board: `timeoriginalestimate` → `time`,
`customfield_10016` → `story-points`, unknown custom field → `numeric` (with a warning to
consider `t-shirt`). In `--apply` mode, an estimation already configured in `board.yaml` is
preserved. Always review and adjust manually after generation.

**Option B — manual configuration**:

```bash
cp board.example.yaml board.yaml
```

```yaml
board:
  columns:
    - name: "To Do"
      type: todo              # start of lead time

    - name: "Development"
      type: active
      devStart: true          # start of cycle time
      role: dev               # optional: role-aware metrics

    - name: "Review"
      type: queue             # wait time (flow-efficiency)
      role: qa

    - name: "Done"
      type: done

  # Renamed statuses absent from the current Jira API (history only)
  # legacyDoneStatuses:
  #   - "Delivered"

metrics:
  cutoffDate: "2024-01-01"    # ignore issues delivered before this date
  bugIssueTypes:
    - "Bug"

  # KPI health signals in the report (optional)
  # healthThresholds:
  #   leadTimeMedianDays:     { warn: 5,    crit: 10   }
  #   cycleTimeMedianDays:    { warn: 3,    crit: 7    }
  #   throughputWeekly:       { warn: 3,    crit: 1    }   # higher = better
  #   wipCount:               { warn: 5,    crit: 8    }
  #   bugCycleTimeMedianDays: { warn: 3,    crit: 7    }
  #   bugRatio:               { warn: 0.20, crit: 0.40 }

# HTML report customization (optional)
# report:
#   title: "Platform Team"                 # Replaces "Lean Report — {projectKey}" in title and header
#   logoUrl: "./assets/logo.png"           # Local path (embedded as base64) or http(s) URL
#   fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"  # Replaces IBM Plex
#   customCssPath: "./my-report.css"       # CSS injected after default styles (normal cascade)
#   excludeTabs:                           # Tabs to hide: delivery, quality, roles, forecast, advanced
#     - roles
#     - forecast
#   templatePath: "./report.hbs"           # Custom Handlebars template (replaces the built-in HTML renderer)
```

#### Column types

| `type` | Role in metrics |
|---|---|
| `todo` | Start of **lead time** |
| `active` + `devStart: true` | Start of **cycle time** |
| `active` | "Touch time" for **flow efficiency** + WIP |
| `queue` | "Queue time" for **flow efficiency** + WIP |
| `done` | Defines **team delivery** (`done_at`) |

The optional `role: dev | qa | po` field enables role-aware metrics (stage time, WIP per role,
throughput gap, rework, first-time-right). Columns without `role` are silently ignored by
these metrics.

---

## Usage

### Standard workflow

```bash
npm run sync        # Pull Jira → SQLite (issues, transitions, sprints, statuses)
npm run snapshots   # Compute weekly history (required before report)
npm run report      # Generate ./report.html
```

Or in a single command:

```bash
npm run refresh     # sync → snapshots → report (stops on error)
```

`refresh` accepts the same options as `report`. To generate separate reports per squad:

```bash
npm run refresh -- -c config.keck.yaml    -b board.yaml -o report.keck.html
npm run refresh -- -c config.kepler.yaml  -b board.yaml -o report.kepler.html
npm run refresh -- -c config.james-webb.yaml -b board.yaml -o report.james-webb.html
```

### Individual commands

```bash
# CLI metrics
npm run metrics                          # All metrics
npm run metrics -- -m cycle-time         # Single metric
npm run metrics -- -m cycle-time --json  # Raw JSON output
npm run metrics -- --include-outliers    # Without Tukey filter
npm run metrics:raw                      # Alias for --include-outliers

# List available metric names
npx ts-node src/main.ts list-metrics

# HTML report
npm run report                           # Output: ./report.html
npm run report -- -o /tmp/report.html    # Custom path
npm run report -- --export-template ./my-template  # Export default Handlebars template into ./my-template/

# Config validation
npm run validate    # Checks that board.yaml statuses exist in the database
```

### Common options

| Option | Description | Available on |
|---|---|---|
| `-c, --config <path>` | Path to `config.yaml` (default: `./config.yaml`) | All commands |
| `-b, --board-config <path>` | Path to `board.yaml` (default: `./board.yaml`) | `metrics`, `snapshots`, `report`, `refresh`, `validate-config`, `autoconfig` |
| `-o, --output <path>` | HTML output file (default: `./report.html`) | `report`, `refresh` |
| `--export-template <dir>` | Export `report.hbs` + `context.schema.json` into `<dir>` and exit | `report` |

---

## Metric catalog

| Metric | What it measures |
|---|---|
| `lead-time` | Todo entry → team delivery |
| `cycle-time` | Active dev start → team delivery |
| `lead-time-by-size` / `cycle-time-by-size` | Same, per size bucket (XS/S/M/L/XL/BUG) |
| `lead-time-normalized` / `cycle-time-normalized` | Actual / estimate ratio (detects estimation drift) |
| `bug-cycle-time` | Cycle time for bugs only |
| `throughput` | Issues delivered per week |
| `bug-throughput` | Bugs delivered per week |
| `throughput-weighted` | Estimated person-days delivered per week |
| `wip` | Current WIP in the active sprint |
| `flow-efficiency` | % active time vs total (active + queue) |
| `aging-wip` | Current WIP age vs historical percentiles |
| `forecast` | Monte Carlo P15/P50/P85/P95 over 1/2/4/8 weeks |
| `dev-time-allocation` | Cycle time split features vs bugs per week |
| `bug-backlog` | Open bugs + weekly net flow |
| `stage-time-breakdown` | Median time per role (dev/QA/PO) |
| `wip-per-role` | Current WIP per role |
| `stage-throughput-gap` | Net flow (in − out) per role per week |
| `handoff-rework` | % tickets with backward transitions between roles |
| `first-time-right` | % tickets passing each role in a single pass |
| `scope-change-rate` | % issues whose description/estimate/sprint changed after sprint entry (scope drift) |
| `bottleneck-analysis` | Priority bottleneck per role (Theory of Constraints, composite score 0–1) |

**Notes**:
- All duration metrics produce: mean, median (P50), P85, P95
- Extreme outliers are filtered by default (Tukey Q3 + 1.5 × IQR method); use `--include-outliers` to keep them
- **Delivery = team-done**: `done_at` = first transition to a status with `statusCategory.key = done` (or listed in `board.legacyDoneStatuses`). The Jira `resolutiondate` field is not used.
- **Durations in working days** (Monday–Friday) via `workingDaysBetween()`
- `lead-time` and `cycle-time` share the same population: tickets that have passed through both `todoStatuses` and `devStartStatuses`. Guarantees `lead_time ≥ cycle_time` per ticket. `bug-cycle-time` is exempt (bugs often skip TODO).

---

## HTML report

The report is a standalone file (Chart.js loaded from CDN, no server dependency, shareable by email or Slack).

**5 sections**:
1. **Delivery** — KPIs, lead/cycle time graphs, throughput, WIP, distribution, by size, normalized metrics
2. **Bugs & quality debt** — bug throughput, bug cycle time, dev allocation, bug backlog (net flow bars + open count curve)
3. **Capacity & forecast** — Monte Carlo forecast, aging WIP with clickable Jira links
4. **Flow by role** — stage time, WIP per role, throughput gap, rework, first-time-right
5. **Scope change** — stacked bars per sprint (description / story points / rescheduling) + drift rate, table of changed issues with clickable Jira links; orange alert banner if drift detected on current or previous sprint; section absent if the database has not been migrated (ticket 031)

Each graph includes a trend curve (4-week moving average). KPIs configured with `healthThresholds`
display a color-coded health signal (green / orange / red). The "Flow by role" section is silently
hidden if no `role:` column is configured in `board.yaml`.

A **Semaines / Sprints** toggle appears in the tab bar when sprints with a `start_date` are present in the database. It switches the throughput, weighted throughput, and bug throughput charts between the default weekly view and a per-sprint aggregated view. The active sprint (if any) is included with its partial count and labelled "(en cours)".

---

## Development

```bash
npm run build           # Compile TypeScript → ./dist
npm start               # Run compiled build

npm test                # Unit tests (Vitest)
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage

npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
```

### Adding a metric

1. Create `src/metrics/<name>.ts` implementing `Metric<T>`
2. For duration metrics to delivery, use `buildDeliveredCte(config.doneStatuses)` from `utils.ts` — never `issues.resolved_at`
3. Register in `ALL_METRICS` in `src/metrics/index.ts`
4. Verify the result shape is recognized by `extractStats` in `snapshots/compute.ts` (add an explicit branch if not)
5. If the metric is non-deterministic (Monte Carlo) or should not be backfilled, add an explicit skip in `snapshots/compute.ts`

See `docs/coding-standards.md` for full conventions (mandatory TDD, strict TypeScript, plugin pattern, etc.)
and `CLAUDE.md` for the detailed architecture.

---

## Architecture

```
Jira REST API v2
      │
      ▼
src/jira/client.ts      ← Axios, pagination, 200ms between pages
      │
      ▼
src/sync.ts             ← Orchestration: statuses, sprints, issues, transitions
      │
      ▼
src/db/store.ts         ← better-sqlite3, WAL, atomic transactions
      │
   SQLite
      │
      ├── src/metrics/          ← Plugin registry (ALL_METRICS)
      ├── src/snapshots/        ← Weekly history backfill (metric_snapshots)
      └── src/report/           ← Standalone HTML renderer (Chart.js CDN)
```

**Stack**: Node.js · TypeScript 6 · better-sqlite3 · Axios · Commander.js · Chart.js

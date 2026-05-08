# lean-jira — Genericity & International Adoption Design

**Date:** 2026-05-09  
**Goal:** Make lean-jira usable by the broadest possible audience (international open-source adoption).  
**Distribution:** git clone (no npm publish for now).  
**Approach:** i18n first, then unblocking tickets, then open-source infrastructure.

---

## Section 1 — i18n Architecture (Ticket 040)

### Scope

Four surfaces to translate:
1. CLI messages — errors, stdout, progress logs
2. HTML report — labels, section titles, tooltips, KPI health messages, bottleneck recommendations
3. README — rewrite in English; current README.md becomes README.fr.md (linked from the English one)
4. Future tickets — all new user-facing strings written in English first, French added alongside

### Architecture

```
src/i18n/
  index.ts       ← t(key, vars?) + initLocale(lang)
  en.ts          ← default locale
  fr.ts          ← French locale
```

`en.ts` and `fr.ts` both export a typed `Locale` object implementing a shared `LocaleShape` interface. TypeScript enforces at compile time that every key exists in both locales — no silent missing strings.

Interpolation: `t('sync.fetchingIssues', { count: 42 })` → `"Fetching 42 issues…"`.

### Triggering

- `--lang <code>` flag on all CLI commands (default: `en`)
- `report.lang: fr` key in `board.yaml` to fix report language independently of the CLI flag
- Both options coexist; CLI flag takes precedence

### Report HTML

`RenderInput` receives a `labels` object (a typed subset of the locale) extracted before rendering. The inline template uses `labels.leadTime`, `labels.healthWarn`, etc. No `t()` call inside the generated HTML — the report stays fully self-contained and stateless.

### README

- `README.md` → rewritten in English (same structure, same content)
- `README.fr.md` → current README.md renamed; linked from the English README header

---

## Section 2 — Ticket Sequence

### Phase 1 — Immediate unblocking (parallel)

| Ticket | Subject | Size | Why |
|---|---|---|---|
| **040** *(new)* | i18n English/French | XL | #1 barrier to international adoption |
| **030** | Jira Server / Data Center (PAT auth) | S | Unblocks all self-hosted teams; 3 files, low risk |

### Phase 2 — Estimation (sequential, constrained)

039a → 039b → 039c → 039d

Each ticket depends on the previous. Unblocks teams estimating in story points or t-shirt sizes. Without this, `throughput-weighted`, `lead-time-by-size`, and `cycle-time-by-size` are not usable for them.

### Phase 3 — Report customization

028 first (YAML config, M), then 029 (Handlebars template, L — depends on 028). Lets each team adapt the report to their context without forking.

### Phase 4 — Advanced analytics

037 Bottleneck analysis (L) — high differentiating value, not a prerequisite for adoption.

### Transverse — Open-source infrastructure

Can be done in parallel with any phase. See Section 3.

---

## Section 3 — Open-Source Infrastructure

### LICENSE

No `LICENSE` file at the repository root. **MIT** is the standard choice for a CLI tool (permissive, maximum adoption). File to create.

### CONTRIBUTING.md

Minimal content useful to an external contributor:
- Prerequisites (Node 18+, `npm install`)
- Dev workflow (TDD mandatory: Red → Green → Refactor)
- Commit conventions + linting (`npm run lint:fix`)
- How to add a metric (summary of the guide in CLAUDE.md)
- How to open a PR (ticket-spec before code; `docs/specs/tickets/<NNN>-<slug>/`)

### GitHub Actions CI

`.github/workflows/ci.yml` — triggered on push and PR to `master`:

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run lint
```

Zero external dependencies, no secrets required — works immediately.

### Issue Templates

`.github/ISSUE_TEMPLATE/`:
- `bug_report.md` — Node version, OS, anonymized config.yaml, command + output
- `feature_request.md` — user story format "As a… I want… so that…" (consistent with existing specs)

### Chart.js CDN dependency

The HTML report breaks without internet access. Current state: Chart.js loaded from CDN. Not addressed in any existing ticket. Options:
- Document the limitation in README
- Create a future ticket for `--embed-chartjs` flag (bundles Chart.js inline at report generation time)

---

## Summary: gaps vs. existing tickets

| Gap | Addressed by |
|---|---|
| English UI / CLI | Ticket 040 (new) |
| French kept as option | Ticket 040 `--lang fr` |
| Jira Server / DC | Ticket 030 (specced, S) |
| SP / t-shirt estimation | Tickets 039a–d (specced, 4×M) |
| Report branding/customization | Tickets 028 + 029 (specced, M+L) |
| Bottleneck signal | Ticket 037 (specced, L) |
| LICENSE | New file (trivial) |
| CONTRIBUTING.md | New file |
| GitHub Actions CI | New file |
| Issue templates | New files |
| Chart.js offline | Future ticket (optional) |
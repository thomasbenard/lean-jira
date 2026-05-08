# Contributing to lean-jira

## Prerequisites

- Node.js 18+
- `npm install`

## Development workflow

**TDD is mandatory.** Every change (feature, bug fix, refactor with behavior change) follows
Red → Green → Refactor. Tests are written *before* production code.

```bash
npm test              # run test suite (Vitest)
npm run test:watch    # watch mode
npm run build         # compile TypeScript → ./dist
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
```

## Conventions

- TypeScript strict, double quotes, 2-space indent, semicolons, trailing commas
- camelCase in TypeScript, snake_case in SQL
- Comments explain *why*, never *what*
- French for prose/logs/test names, English for code identifiers

Full details: [`docs/coding-standards.md`](docs/coding-standards.md)

## Adding a metric

1. Create `src/metrics/<name>.ts` implementing `Metric<T>`
2. Use `buildDeliveredCte(config.doneStatuses)` from `utils.ts` for delivery endpoints — never `issues.resolved_at`
3. Register in `ALL_METRICS` in `src/metrics/index.ts`
4. Verify the result shape is handled by `extractStats` in `snapshots/compute.ts`
5. If non-deterministic (Monte Carlo) or should not be backfilled, add an explicit skip in `snapshots/compute.ts`

## Spec before code

Non-trivial tickets require a spec folder under `docs/specs/tickets/<NNN>-<slug>/` before any
implementation. See existing folders for examples. Ticket numbering is sequential (3 digits).

## Opening a pull request

1. Branch from `master`
2. Write the spec (if non-trivial)
3. Implement with TDD
4. `npm test && npm run build && npm run lint` must pass
5. Open PR — the CI workflow will run automatically

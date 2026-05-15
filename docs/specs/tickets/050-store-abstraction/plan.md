# Ticket 050 — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inverser la dépendance des 25 métriques + snapshots + report + sync vis-à-vis de SQLite. Aucun fichier métier n'importe `better-sqlite3` ni ne contient de SQL après ce plan.

**Architecture:** Trois nouvelles couches : `ReadStore` / `WriteStore` (interfaces de domaine), `SqliteStore` (unique implémentation, encapsule l'intégralité du SQL existant), `MetricsContext` (indexation in-memory partagée entre les 25 métriques). Bootstrap unique dans `main.ts`.

**Tech Stack:** TypeScript 6 strict, better-sqlite3 (cantonné à `src/store/sqlite/**`), Vitest (TDD obligatoire), Commander.js.

**Référence spec :** `docs/specs/tickets/050-store-abstraction/spec-fonctionnelle.md` + `spec-technique.md`.

---

## Vue d'ensemble par phase

| Phase | Tâches | Sortie |
|---|---|---|
| 0 — Baseline | 1 | snapshot JSON de référence avant refactor |
| 1 — Types Store | 1 | `src/store/types.ts` (interfaces + records) |
| 2 — SqliteStore | 11 | `src/store/sqlite/**` complet |
| 3 — MetricsContext | 2 | `src/metrics/context.ts` + nouvelle signature `Metric<T>` |
| 4 — Migration métriques | 24 | 25 métriques sans SQL |
| 5 — Snapshots / Report / Sync | 3 | consommateurs migrés |
| 6 — Bootstrap + nettoyage | 2 | `main.ts` injecte un seul Store ; `src/db/` supprimé ; test architecture |

Total ~44 commits TDD. Chaque tâche commit ≥1 fois.

**Pattern récurrent par migration de métrique** (référence pour les tâches Phase 4) :

1. Renommer signature : `compute(db, config)` → `compute(ctx)`.
2. Supprimer imports `Database`, `buildDeliveredCte`, `buildWindowFragment`, `placeholders`, `fetchDeliveredTransitions`, `groupByIssue`.
3. Remplacer requêtes SQL par parcours `ctx.transitionsByIssue`, `ctx.cycleTimePopulation`, `ctx.deliveredAt`, `ctx.issues`.
4. Lire `config` via `ctx.config`.
5. Le test associé (`tests/metrics/<metric>.test.ts`) doit continuer à passer **inchangé** sauf l'appel : remplacer `metric.compute(db, config)` par `metric.compute(buildMetricsContext(new SqliteStore(db), config))` (extrait dans helper `tests/_helpers/createTestContext.ts` créé en Phase 3).

---

## Phase 0 — Baseline de régression

### Task 0.1: Geler le JSON de référence avant refactor

**Pourquoi :** CF-01 exige l'égalité octet-à-octet du JSON de `npm run metrics --json` après refactor. Geler maintenant.

**Files:**
- Create: `tests/snapshots/__snapshots__/metrics-baseline.fake.json`
- Create: `tests/snapshots/metrics-output.test.ts`

- [ ] **Step 1 : Générer le snapshot baseline sur fixtures fake**

```bash
npm run metrics -- -b board.fake.yaml --json > tests/snapshots/__snapshots__/metrics-baseline.fake.json
```

Vérifier que le fichier fait > 50 KB et contient des clés `lead-time`, `cycle-time`, `throughput`, etc.

- [ ] **Step 2 : Écrire le test de comparaison**

```typescript
// tests/snapshots/metrics-output.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

describe("metrics output baseline (CF-01)", () => {
  it("npm run metrics --json matches baseline", () => {
    const out = execFileSync("npm", ["run", "metrics", "--silent", "--", "-b", "board.fake.yaml", "--json"], {
      encoding: "utf-8",
      shell: true,
    });
    const baseline = readFileSync("tests/snapshots/__snapshots__/metrics-baseline.fake.json", "utf-8");
    expect(JSON.parse(out)).toEqual(JSON.parse(baseline));
  });
});
```

- [ ] **Step 3 : Run test → doit passer (état actuel = baseline)**

Run: `npx vitest run tests/snapshots/metrics-output.test.ts`
Expected: PASS

- [ ] **Step 4 : Commit**

```bash
git add tests/snapshots/__snapshots__/metrics-baseline.fake.json tests/snapshots/metrics-output.test.ts
git commit -m "test(snapshots): freeze metrics-output baseline before store refactor (ticket 050)"
```

---

## Phase 1 — Contrat ReadStore / WriteStore

### Task 1.1: Créer `src/store/types.ts`

**Files:**
- Create: `src/store/types.ts`
- Create: `tests/store/types.test-d.ts` (test de typage avec `expectTypeOf`)

- [ ] **Step 1 : Écrire le test de typage**

```typescript
// tests/store/types.test-d.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  ReadStore, WriteStore, Store,
  IssueRecord, TransitionRecord, SprintRecord,
  StatusRecord, IssueFieldChangeRecord, IssueSprintRecord,
  SnapshotRecord, SyncLogRecord,
} from "../../src/store/types";

describe("Store types", () => {
  it("Store extends both ReadStore and WriteStore", () => {
    expectTypeOf<Store>().toMatchTypeOf<ReadStore>();
    expectTypeOf<Store>().toMatchTypeOf<WriteStore>();
  });

  it("ReadStore.issues.byKey returns nullable", () => {
    expectTypeOf<ReadStore["issues"]["byKey"]>().returns.toEqualTypeOf<IssueRecord | null>();
  });

  it("WriteStore.transitions.replaceForIssues accepts items without id", () => {
    type Arg = Parameters<WriteStore["transitions"]["replaceForIssues"]>[0];
    expectTypeOf<Arg[number]["rows"][number]>().toEqualTypeOf<Omit<TransitionRecord, "id">>();
  });

  it("WriteStore.transaction returns the callback's return value", () => {
    const fn = (): number => 42;
    const result: number = {} as Store extends infer S ? (S extends WriteStore ? ReturnType<S["transaction"]<number>> : never) : never;
    expectTypeOf(result).toEqualTypeOf<number>();
  });
});
```

- [ ] **Step 2 : Run test → doit échouer (types absents)**

Run: `npx vitest run tests/store/types.test-d.ts`
Expected: FAIL — Cannot find module '../../src/store/types'

- [ ] **Step 3 : Implémenter `src/store/types.ts`**

```typescript
// src/store/types.ts

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

- [ ] **Step 4 : Run test → doit passer**

Run: `npx vitest run tests/store/types.test-d.ts`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add src/store/types.ts tests/store/types.test-d.ts
git commit -m "feat(store): define ReadStore/WriteStore/Store interfaces (ticket 050)"
```

---

## Phase 2 — SqliteStore (un sous-domaine par tâche)

Les sous-domaines partagent un même squelette : helper de contrat + implémentation déléguée à du SQL repris de `src/db/store.ts`. **Ne pas supprimer `src/db/store.ts`** avant la Task 6.2 — les anciens consommateurs continuent à fonctionner pendant la migration.

### Task 2.1: Schema (`openDb` + `migrate`)

**Files:**
- Create: `src/store/sqlite/schema.ts`
- Modify: `src/db/store.ts` (re-export `openDb` depuis `../store/sqlite/schema` pour compat temporaire)

- [ ] **Step 1 : Écrire le test**

```typescript
// tests/store/sqlite/schema.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../../src/store/sqlite/schema";

describe("openDb", () => {
  it("creates an in-memory DB with the issues table", () => {
    const db = openDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("current_sprint_id");
    expect(cols.map((c) => c.name)).toContain("story_points");
    expect(cols.map((c) => c.name)).toContain("size_label");
  });

  it("activates WAL journal mode", () => {
    const db = openDb(":memory:");
    const mode = (db.pragma("journal_mode", { simple: true }) as string).toLowerCase();
    expect(["memory", "wal"]).toContain(mode); // memory pour :memory:, wal pour fichier
  });
});
```

- [ ] **Step 2 : Run → FAIL (module absent)**

Run: `npx vitest run tests/store/sqlite/schema.test.ts`
Expected: FAIL

- [ ] **Step 3 : Créer `src/store/sqlite/schema.ts`** (copie verbatim depuis `src/db/store.ts:1-33`, adapter le chemin du `schema.sql` vers `../../db/schema.sql`)

```typescript
// src/store/sqlite/schema.ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);

  return db;
}

function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "current_sprint_id")) {
    db.exec("ALTER TABLE issues ADD COLUMN current_sprint_id INTEGER");
  }
  if (!cols.some((c) => c.name === "original_estimate_seconds")) {
    db.exec("ALTER TABLE issues ADD COLUMN original_estimate_seconds INTEGER");
  }
  if (!cols.some((c) => c.name === "story_points")) {
    db.exec("ALTER TABLE issues ADD COLUMN story_points REAL");
  }
  if (!cols.some((c) => c.name === "size_label")) {
    db.exec("ALTER TABLE issues ADD COLUMN size_label TEXT");
  }
}
```

- [ ] **Step 4 : Re-export depuis `src/db/store.ts` pour compat**

Modifier le début de `src/db/store.ts` :

```typescript
// src/db/store.ts
import Database from "better-sqlite3";
import { type FieldChange, type StoredIssue, type StoredSprint, type StoredStatus, type Transition } from "../jira/types";
import { now } from "../clock";

export { openDb } from "../store/sqlite/schema";
// Supprimer la définition locale de openDb + migrate + import fs/path.
```

- [ ] **Step 5 : Run all tests → tous passent (compat préservée)**

Run: `npx vitest run`
Expected: tout vert.

- [ ] **Step 6 : Commit**

```bash
git add src/store/sqlite/schema.ts src/db/store.ts tests/store/sqlite/schema.test.ts
git commit -m "feat(store): extract openDb to src/store/sqlite/schema (ticket 050)"
```

### Task 2.2: Issues subdomain

**Files:**
- Create: `src/store/sqlite/issues.ts`
- Create: `tests/store/sqlite/issues.test.ts`

- [ ] **Step 1 : Test de contrat**

```typescript
// tests/store/sqlite/issues.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { IssuesSqlite } from "../../../src/store/sqlite/issues";
import type { IssueRecord } from "../../../src/store/types";

let db: Database.Database;
let issues: IssuesSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  issues = new IssuesSqlite(db);
});

const sample: IssueRecord = {
  key: "ABC-1", summary: "Test", issueType: "Story",
  createdAt: "2026-01-01T00:00:00Z", resolvedAt: null,
  currentStatus: "To Do", assignee: null, priority: null,
  currentSprintId: null, originalEstimateSeconds: 28800,
  storyPoints: null, sizeLabel: null,
};

describe("IssuesSqlite", () => {
  it("upsertMany then all returns the row", () => {
    issues.upsertMany([sample]);
    expect(issues.all()).toEqual([sample]);
  });

  it("byKey returns null for missing key", () => {
    expect(issues.byKey("NOPE-1")).toBeNull();
  });

  it("byKey returns the matching row", () => {
    issues.upsertMany([sample]);
    expect(issues.byKey("ABC-1")).toEqual(sample);
  });

  it("upsertMany updates existing row", () => {
    issues.upsertMany([sample]);
    issues.upsertMany([{ ...sample, summary: "Updated" }]);
    expect(issues.byKey("ABC-1")?.summary).toBe("Updated");
  });
});
```

- [ ] **Step 2 : Run → FAIL**

Run: `npx vitest run tests/store/sqlite/issues.test.ts`
Expected: FAIL

- [ ] **Step 3 : Implémenter `src/store/sqlite/issues.ts`**

```typescript
// src/store/sqlite/issues.ts
import type Database from "better-sqlite3";
import type { IssueRecord } from "../types";

interface Row {
  key: string; summary: string; issue_type: string;
  created_at: string; resolved_at: string | null;
  current_status: string; assignee: string | null; priority: string | null;
  current_sprint_id: number | null;
  original_estimate_seconds: number | null;
  story_points: number | null;
  size_label: string | null;
}

function toRecord(r: Row): IssueRecord {
  return {
    key: r.key, summary: r.summary, issueType: r.issue_type,
    createdAt: r.created_at, resolvedAt: r.resolved_at,
    currentStatus: r.current_status, assignee: r.assignee, priority: r.priority,
    currentSprintId: r.current_sprint_id,
    originalEstimateSeconds: r.original_estimate_seconds,
    storyPoints: r.story_points, sizeLabel: r.size_label,
  };
}

export class IssuesSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): IssueRecord[] {
    const rows = this.db.prepare("SELECT * FROM issues ORDER BY key").all() as Row[];
    return rows.map(toRecord);
  }

  byKey(key: string): IssueRecord | null {
    const row = this.db.prepare("SELECT * FROM issues WHERE key = ?").get(key) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  upsertMany(records: IssueRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO issues (key, summary, issue_type, created_at, resolved_at, current_status, assignee, priority, current_sprint_id, original_estimate_seconds, story_points, size_label)
      VALUES (@key, @summary, @issueType, @createdAt, @resolvedAt, @currentStatus, @assignee, @priority, @currentSprintId, @originalEstimateSeconds, @storyPoints, @sizeLabel)
      ON CONFLICT(key) DO UPDATE SET
        summary        = excluded.summary,
        issue_type     = excluded.issue_type,
        resolved_at    = excluded.resolved_at,
        current_status = excluded.current_status,
        assignee       = excluded.assignee,
        priority       = excluded.priority,
        current_sprint_id = excluded.current_sprint_id,
        original_estimate_seconds = excluded.original_estimate_seconds,
        story_points   = excluded.story_points,
        size_label     = excluded.size_label
    `);
    const tx = this.db.transaction((rows: IssueRecord[]) => {
      for (const r of rows) { stmt.run(r); }
    });
    tx(records);
  }
}
```

- [ ] **Step 4 : Run → PASS**

Run: `npx vitest run tests/store/sqlite/issues.test.ts`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/issues.ts tests/store/sqlite/issues.test.ts
git commit -m "feat(store): implement IssuesSqlite read/write (ticket 050)"
```

### Task 2.3: Transitions subdomain

**Files:**
- Create: `src/store/sqlite/transitions.ts`
- Create: `tests/store/sqlite/transitions.test.ts`

- [ ] **Step 1 : Test de contrat**

```typescript
// tests/store/sqlite/transitions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { TransitionsSqlite } from "../../../src/store/sqlite/transitions";

let db: Database.Database;
let transitions: TransitionsSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  transitions = new TransitionsSqlite(db);
});

describe("TransitionsSqlite", () => {
  it("replaceForIssue inserts rows then byIssue returns them ordered", () => {
    transitions.replaceForIssue("ABC-1", [
      { issueKey: "ABC-1", fromStatus: null,    toStatus: "To Do",       transitionedAt: "2026-01-01T00:00:00Z" },
      { issueKey: "ABC-1", fromStatus: "To Do", toStatus: "In Progress", transitionedAt: "2026-01-02T00:00:00Z" },
    ]);
    const rows = transitions.byIssue("ABC-1");
    expect(rows.map((r) => r.toStatus)).toEqual(["To Do", "In Progress"]);
    expect(rows[0].id).toBeGreaterThan(0);
  });

  it("replaceForIssue replaces previous rows", () => {
    transitions.replaceForIssue("ABC-1", [
      { issueKey: "ABC-1", fromStatus: null, toStatus: "Old", transitionedAt: "2026-01-01T00:00:00Z" },
    ]);
    transitions.replaceForIssue("ABC-1", [
      { issueKey: "ABC-1", fromStatus: null, toStatus: "New", transitionedAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(transitions.byIssue("ABC-1").map((r) => r.toStatus)).toEqual(["New"]);
  });

  it("replaceForIssues batch processes multiple issues atomically", () => {
    transitions.replaceForIssues([
      { key: "ABC-1", rows: [{ issueKey: "ABC-1", fromStatus: null, toStatus: "A", transitionedAt: "2026-01-01T00:00:00Z" }] },
      { key: "ABC-2", rows: [{ issueKey: "ABC-2", fromStatus: null, toStatus: "B", transitionedAt: "2026-01-01T00:00:00Z" }] },
    ]);
    expect(transitions.all()).toHaveLength(2);
  });

  it("all returns rows ordered by id", () => {
    transitions.replaceForIssues([
      { key: "ABC-1", rows: [{ issueKey: "ABC-1", fromStatus: null, toStatus: "A", transitionedAt: "2026-01-01T00:00:00Z" }] },
      { key: "ABC-2", rows: [{ issueKey: "ABC-2", fromStatus: null, toStatus: "B", transitionedAt: "2026-01-01T00:00:00Z" }] },
    ]);
    const all = transitions.all();
    expect(all[0].id).toBeLessThan(all[1].id);
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/transitions.ts`**

```typescript
// src/store/sqlite/transitions.ts
import type Database from "better-sqlite3";
import type { TransitionRecord } from "../types";

interface Row {
  id: number;
  issue_key: string;
  from_status: string | null;
  to_status: string;
  transitioned_at: string;
}

function toRecord(r: Row): TransitionRecord {
  return {
    id: r.id, issueKey: r.issue_key, fromStatus: r.from_status,
    toStatus: r.to_status, transitionedAt: r.transitioned_at,
  };
}

export class TransitionsSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): TransitionRecord[] {
    const rows = this.db.prepare("SELECT * FROM transitions ORDER BY id").all() as Row[];
    return rows.map(toRecord);
  }

  byIssue(key: string): TransitionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM transitions WHERE issue_key = ? ORDER BY transitioned_at ASC, id ASC",
    ).all(key) as Row[];
    return rows.map(toRecord);
  }

  replaceForIssue(key: string, records: Omit<TransitionRecord, "id">[]): void {
    this.replaceForIssues([{ key, rows: records }]);
  }

  replaceForIssues(items: { key: string; rows: Omit<TransitionRecord, "id">[] }[]): void {
    const del = this.db.prepare("DELETE FROM transitions WHERE issue_key = ?");
    const ins = this.db.prepare(`
      INSERT INTO transitions (issue_key, from_status, to_status, transitioned_at)
      VALUES (@issueKey, @fromStatus, @toStatus, @transitionedAt)
    `);
    const tx = this.db.transaction((batches: { key: string; rows: Omit<TransitionRecord, "id">[] }[]) => {
      for (const b of batches) {
        del.run(b.key);
        for (const r of b.rows) { ins.run(r); }
      }
    });
    tx(items);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/transitions.ts tests/store/sqlite/transitions.test.ts
git commit -m "feat(store): implement TransitionsSqlite read/write (ticket 050)"
```

### Task 2.4: Sprints subdomain

**Files:**
- Create: `src/store/sqlite/sprints.ts`
- Create: `tests/store/sqlite/sprints.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/sprints.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SprintsSqlite } from "../../../src/store/sqlite/sprints";
import type { SprintRecord } from "../../../src/store/types";

let db: Database.Database;
let sprints: SprintsSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  sprints = new SprintsSqlite(db);
});

const sample: SprintRecord = {
  id: 42, name: "Sprint 1", state: "active",
  startDate: "2026-01-01T00:00:00Z", endDate: "2026-01-15T00:00:00Z",
  boardId: 7,
};

describe("SprintsSqlite", () => {
  it("upsertMany then all returns row", () => {
    sprints.upsertMany([sample]);
    expect(sprints.all()).toEqual([sample]);
  });

  it("byId returns matching sprint", () => {
    sprints.upsertMany([sample]);
    expect(sprints.byId(42)).toEqual(sample);
  });

  it("byId returns null when missing", () => {
    expect(sprints.byId(999)).toBeNull();
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/sprints.ts`**

```typescript
// src/store/sqlite/sprints.ts
import type Database from "better-sqlite3";
import type { SprintRecord } from "../types";

interface Row {
  id: number; name: string; state: string;
  start_date: string | null; end_date: string | null; board_id: number;
}

function toRecord(r: Row): SprintRecord {
  return {
    id: r.id, name: r.name, state: r.state,
    startDate: r.start_date, endDate: r.end_date, boardId: r.board_id,
  };
}

export class SprintsSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): SprintRecord[] {
    return (this.db.prepare("SELECT * FROM sprints ORDER BY id").all() as Row[]).map(toRecord);
  }

  byId(id: number): SprintRecord | null {
    const row = this.db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  upsertMany(records: SprintRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO sprints (id, name, state, start_date, end_date, board_id)
      VALUES (@id, @name, @state, @startDate, @endDate, @boardId)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, state = excluded.state,
        start_date = excluded.start_date, end_date = excluded.end_date,
        board_id = excluded.board_id
    `);
    const tx = this.db.transaction((rows: SprintRecord[]) => {
      for (const r of rows) { stmt.run(r); }
    });
    tx(records);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/sprints.ts tests/store/sqlite/sprints.test.ts
git commit -m "feat(store): implement SprintsSqlite read/write (ticket 050)"
```

### Task 2.5: Statuses subdomain

**Files:**
- Create: `src/store/sqlite/statuses.ts`
- Create: `tests/store/sqlite/statuses.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/statuses.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { StatusesSqlite } from "../../../src/store/sqlite/statuses";

let db: Database.Database;
let statuses: StatusesSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  statuses = new StatusesSqlite(db);
});

describe("StatusesSqlite", () => {
  it("upsertMany then all returns rows ordered by name", () => {
    statuses.upsertMany([
      { name: "Done",  categoryKey: "done", categoryName: "Done" },
      { name: "To Do", categoryKey: "new",  categoryName: "To Do" },
    ]);
    expect(statuses.all().map((s) => s.name)).toEqual(["Done", "To Do"]);
  });

  it("upsertMany updates category on conflict", () => {
    statuses.upsertMany([{ name: "X", categoryKey: "new", categoryName: "X" }]);
    statuses.upsertMany([{ name: "X", categoryKey: "done", categoryName: "X-renamed" }]);
    expect(statuses.all()[0].categoryKey).toBe("done");
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/statuses.ts`**

```typescript
// src/store/sqlite/statuses.ts
import type Database from "better-sqlite3";
import type { StatusRecord } from "../types";

interface Row { name: string; category_key: string; category_name: string; }

function toRecord(r: Row): StatusRecord {
  return { name: r.name, categoryKey: r.category_key, categoryName: r.category_name };
}

export class StatusesSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): StatusRecord[] {
    return (this.db.prepare("SELECT * FROM statuses ORDER BY name").all() as Row[]).map(toRecord);
  }

  upsertMany(records: StatusRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO statuses (name, category_key, category_name)
      VALUES (@name, @categoryKey, @categoryName)
      ON CONFLICT(name) DO UPDATE SET
        category_key  = excluded.category_key,
        category_name = excluded.category_name
    `);
    const tx = this.db.transaction((rows: StatusRecord[]) => {
      for (const r of rows) { stmt.run(r); }
    });
    tx(records);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/statuses.ts tests/store/sqlite/statuses.test.ts
git commit -m "feat(store): implement StatusesSqlite read/write (ticket 050)"
```

### Task 2.6: IssueFieldChanges subdomain

**Files:**
- Create: `src/store/sqlite/issueFieldChanges.ts`
- Create: `tests/store/sqlite/issueFieldChanges.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/issueFieldChanges.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { IssueFieldChangesSqlite } from "../../../src/store/sqlite/issueFieldChanges";

let db: Database.Database;
let changes: IssueFieldChangesSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  changes = new IssueFieldChangesSqlite(db);
});

describe("IssueFieldChangesSqlite", () => {
  it("replaceForIssues inserts then byIssueAndField returns ordered rows", () => {
    changes.replaceForIssues([{
      key: "ABC-1",
      rows: [
        { issueKey: "ABC-1", fieldName: "description", fromValue: "old", toValue: "new", changedAt: "2026-01-02T00:00:00Z" },
        { issueKey: "ABC-1", fieldName: "summary",     fromValue: "x",   toValue: "y",   changedAt: "2026-01-01T00:00:00Z" },
      ],
    }]);
    const desc = changes.byIssueAndField("ABC-1", "description");
    expect(desc).toHaveLength(1);
    expect(desc[0].toValue).toBe("new");
  });

  it("replaceForIssues replaces previous rows", () => {
    changes.replaceForIssues([{
      key: "ABC-1",
      rows: [{ issueKey: "ABC-1", fieldName: "description", fromValue: null, toValue: "v1", changedAt: "2026-01-01T00:00:00Z" }],
    }]);
    changes.replaceForIssues([{
      key: "ABC-1",
      rows: [{ issueKey: "ABC-1", fieldName: "description", fromValue: null, toValue: "v2", changedAt: "2026-01-02T00:00:00Z" }],
    }]);
    expect(changes.byIssueAndField("ABC-1", "description").map((c) => c.toValue)).toEqual(["v2"]);
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/issueFieldChanges.ts`**

```typescript
// src/store/sqlite/issueFieldChanges.ts
import type Database from "better-sqlite3";
import type { IssueFieldChangeRecord } from "../types";

interface Row {
  issue_key: string; field_name: string;
  from_value: string | null; to_value: string | null;
  changed_at: string;
}

function toRecord(r: Row): IssueFieldChangeRecord {
  return {
    issueKey: r.issue_key, fieldName: r.field_name,
    fromValue: r.from_value, toValue: r.to_value, changedAt: r.changed_at,
  };
}

export class IssueFieldChangesSqlite {
  constructor(private readonly db: Database.Database) {}

  byIssueAndField(key: string, field: string): IssueFieldChangeRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM issue_field_changes WHERE issue_key = ? AND field_name = ? ORDER BY changed_at ASC",
    ).all(key, field) as Row[];
    return rows.map(toRecord);
  }

  replaceForIssues(items: { key: string; rows: IssueFieldChangeRecord[] }[]): void {
    const del = this.db.prepare("DELETE FROM issue_field_changes WHERE issue_key = ?");
    const ins = this.db.prepare(`
      INSERT INTO issue_field_changes (issue_key, field_name, from_value, to_value, changed_at)
      VALUES (@issueKey, @fieldName, @fromValue, @toValue, @changedAt)
    `);
    const tx = this.db.transaction((batches: { key: string; rows: IssueFieldChangeRecord[] }[]) => {
      for (const b of batches) {
        del.run(b.key);
        for (const r of b.rows) { ins.run(r); }
      }
    });
    tx(items);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/issueFieldChanges.ts tests/store/sqlite/issueFieldChanges.test.ts
git commit -m "feat(store): implement IssueFieldChangesSqlite (ticket 050)"
```

### Task 2.7: IssueSprints subdomain

**Files:**
- Create: `src/store/sqlite/issueSprints.ts`
- Create: `tests/store/sqlite/issueSprints.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/issueSprints.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SprintsSqlite } from "../../../src/store/sqlite/sprints";
import { IssuesSqlite } from "../../../src/store/sqlite/issues";
import { IssueSprintsSqlite } from "../../../src/store/sqlite/issueSprints";

let db: Database.Database;

beforeEach(() => {
  db = openDb(":memory:");
  // satisfaire les FK : créer 1 issue + 2 sprints avant
  new IssuesSqlite(db).upsertMany([{
    key: "ABC-1", summary: "X", issueType: "Story",
    createdAt: "2026-01-01T00:00:00Z", resolvedAt: null,
    currentStatus: "To Do", assignee: null, priority: null,
    currentSprintId: null, originalEstimateSeconds: null,
    storyPoints: null, sizeLabel: null,
  }]);
  new SprintsSqlite(db).upsertMany([
    { id: 1, name: "S1", state: "closed", startDate: null, endDate: null, boardId: 1 },
    { id: 2, name: "S2", state: "active", startDate: null, endDate: null, boardId: 1 },
  ]);
});

describe("IssueSprintsSqlite", () => {
  it("replaceForIssues then byIssue returns sprintIds", () => {
    const store = new IssueSprintsSqlite(db);
    store.replaceForIssues([{ key: "ABC-1", sprintIds: [1, 2] }]);
    expect(store.byIssue("ABC-1").map((r) => r.sprintId).sort()).toEqual([1, 2]);
  });

  it("bySprint returns issues in sprint", () => {
    const store = new IssueSprintsSqlite(db);
    store.replaceForIssues([{ key: "ABC-1", sprintIds: [1] }]);
    expect(store.bySprint(1).map((r) => r.issueKey)).toEqual(["ABC-1"]);
    expect(store.bySprint(2)).toEqual([]);
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/issueSprints.ts`**

```typescript
// src/store/sqlite/issueSprints.ts
import type Database from "better-sqlite3";
import type { IssueSprintRecord } from "../types";

interface Row { issue_key: string; sprint_id: number; }

function toRecord(r: Row): IssueSprintRecord {
  return { issueKey: r.issue_key, sprintId: r.sprint_id };
}

export class IssueSprintsSqlite {
  constructor(private readonly db: Database.Database) {}

  bySprint(sprintId: number): IssueSprintRecord[] {
    const rows = this.db.prepare("SELECT * FROM issue_sprints WHERE sprint_id = ?").all(sprintId) as Row[];
    return rows.map(toRecord);
  }

  byIssue(key: string): IssueSprintRecord[] {
    const rows = this.db.prepare("SELECT * FROM issue_sprints WHERE issue_key = ?").all(key) as Row[];
    return rows.map(toRecord);
  }

  replaceForIssues(items: { key: string; sprintIds: number[] }[]): void {
    const del = this.db.prepare("DELETE FROM issue_sprints WHERE issue_key = ?");
    const ins = this.db.prepare("INSERT OR IGNORE INTO issue_sprints (issue_key, sprint_id) VALUES (?, ?)");
    const tx = this.db.transaction((batches: { key: string; sprintIds: number[] }[]) => {
      for (const b of batches) {
        del.run(b.key);
        for (const id of b.sprintIds) { ins.run(b.key, id); }
      }
    });
    tx(items);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/issueSprints.ts tests/store/sqlite/issueSprints.test.ts
git commit -m "feat(store): implement IssueSprintsSqlite (ticket 050)"
```

### Task 2.8: Snapshots subdomain

**Files:**
- Create: `src/store/sqlite/snapshots.ts`
- Create: `tests/store/sqlite/snapshots.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/snapshots.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SnapshotsSqlite } from "../../../src/store/sqlite/snapshots";
import type { SnapshotRecord } from "../../../src/store/types";

let db: Database.Database;
let snaps: SnapshotsSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  snaps = new SnapshotsSqlite(db);
});

const r1: SnapshotRecord = { snapshotDate: "2026-01-01", metricName: "lead-time", bucket: "ALL", stat: "medianDays", value: 4.2 };
const r2: SnapshotRecord = { snapshotDate: "2026-01-08", metricName: "lead-time", bucket: "ALL", stat: "medianDays", value: 5.0 };

describe("SnapshotsSqlite", () => {
  it("replaceAll then all returns rows", () => {
    snaps.replaceAll([r1, r2]);
    expect(snaps.all()).toHaveLength(2);
  });

  it("replaceAll wipes prior rows", () => {
    snaps.replaceAll([r1]);
    snaps.replaceAll([r2]);
    expect(snaps.all()).toEqual([r2]);
  });

  it("byDate filters", () => {
    snaps.replaceAll([r1, r2]);
    expect(snaps.byDate("2026-01-01")).toEqual([r1]);
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/snapshots.ts`**

```typescript
// src/store/sqlite/snapshots.ts
import type Database from "better-sqlite3";
import type { SnapshotRecord } from "../types";

interface Row {
  snapshot_date: string; metric_name: string;
  bucket: string; stat: string; value: number;
}

function toRecord(r: Row): SnapshotRecord {
  return {
    snapshotDate: r.snapshot_date, metricName: r.metric_name,
    bucket: r.bucket, stat: r.stat, value: r.value,
  };
}

export class SnapshotsSqlite {
  constructor(private readonly db: Database.Database) {}

  all(): SnapshotRecord[] {
    const rows = this.db.prepare("SELECT * FROM metric_snapshots ORDER BY snapshot_date, metric_name, bucket, stat").all() as Row[];
    return rows.map(toRecord);
  }

  byDate(date: string): SnapshotRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM metric_snapshots WHERE snapshot_date = ? ORDER BY metric_name, bucket, stat",
    ).all(date) as Row[];
    return rows.map(toRecord);
  }

  replaceAll(records: SnapshotRecord[]): void {
    const del = this.db.prepare("DELETE FROM metric_snapshots");
    const ins = this.db.prepare(`
      INSERT INTO metric_snapshots (snapshot_date, metric_name, bucket, stat, value)
      VALUES (@snapshotDate, @metricName, @bucket, @stat, @value)
    `);
    const tx = this.db.transaction((rows: SnapshotRecord[]) => {
      del.run();
      for (const r of rows) { ins.run(r); }
    });
    tx(records);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/snapshots.ts tests/store/sqlite/snapshots.test.ts
git commit -m "feat(store): implement SnapshotsSqlite (ticket 050)"
```

### Task 2.9: AppConfig subdomain

**Files:**
- Create: `src/store/sqlite/appConfig.ts`
- Create: `tests/store/sqlite/appConfig.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/appConfig.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { AppConfigSqlite } from "../../../src/store/sqlite/appConfig";

let db: Database.Database;
let cfg: AppConfigSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  cfg = new AppConfigSqlite(db);
});

describe("AppConfigSqlite", () => {
  it("get returns null when missing", () => {
    expect(cfg.get("k")).toBeNull();
  });

  it("set then get round-trips", () => {
    cfg.set("estimation_method", "story-points");
    expect(cfg.get("estimation_method")).toBe("story-points");
  });

  it("set overwrites existing key", () => {
    cfg.set("k", "v1");
    cfg.set("k", "v2");
    expect(cfg.get("k")).toBe("v2");
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/appConfig.ts`**

```typescript
// src/store/sqlite/appConfig.ts
import type Database from "better-sqlite3";

export class AppConfigSqlite {
  constructor(private readonly db: Database.Database) {}

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run(key, value);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/appConfig.ts tests/store/sqlite/appConfig.test.ts
git commit -m "feat(store): implement AppConfigSqlite (ticket 050)"
```

### Task 2.10: SyncLog subdomain

**Files:**
- Create: `src/store/sqlite/syncLog.ts`
- Create: `tests/store/sqlite/syncLog.test.ts`

- [ ] **Step 1 : Test**

```typescript
// tests/store/sqlite/syncLog.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SyncLogSqlite } from "../../../src/store/sqlite/syncLog";

let db: Database.Database;
let log: SyncLogSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  log = new SyncLogSqlite(db);
});

describe("SyncLogSqlite", () => {
  it("lastByProject returns null when empty", () => {
    expect(log.lastByProject("KECK")).toBeNull();
  });

  it("append then lastByProject returns most recent", () => {
    log.append({ syncedAt: "2026-01-01T00:00:00Z", issuesCount: 10, projectKey: "KECK" });
    log.append({ syncedAt: "2026-01-02T00:00:00Z", issuesCount: 12, projectKey: "KECK" });
    log.append({ syncedAt: "2026-01-02T00:00:00Z", issuesCount: 5,  projectKey: "OTHER" });
    expect(log.lastByProject("KECK")?.syncedAt).toBe("2026-01-02T00:00:00Z");
    expect(log.lastByProject("KECK")?.issuesCount).toBe(12);
    expect(log.lastByProject("OTHER")?.issuesCount).toBe(5);
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/syncLog.ts`**

```typescript
// src/store/sqlite/syncLog.ts
import type Database from "better-sqlite3";
import type { SyncLogRecord } from "../types";

interface Row { synced_at: string; issues_count: number; project_key: string; }

function toRecord(r: Row): SyncLogRecord {
  return { syncedAt: r.synced_at, issuesCount: r.issues_count, projectKey: r.project_key };
}

export class SyncLogSqlite {
  constructor(private readonly db: Database.Database) {}

  lastByProject(projectKey: string): SyncLogRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM sync_log WHERE project_key = ? ORDER BY synced_at DESC LIMIT 1",
    ).get(projectKey) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  append(record: SyncLogRecord): void {
    this.db.prepare(
      "INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)",
    ).run(record.syncedAt, record.issuesCount, record.projectKey);
  }
}
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/syncLog.ts tests/store/sqlite/syncLog.test.ts
git commit -m "feat(store): implement SyncLogSqlite (ticket 050)"
```

### Task 2.11: Façade `SqliteStore`

**Files:**
- Create: `src/store/sqlite/index.ts`
- Create: `tests/store/sqlite/facade.test.ts`

- [ ] **Step 1 : Test (façade implémente bien `Store`)**

```typescript
// tests/store/sqlite/facade.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../../src/store/sqlite/schema";
import { SqliteStore } from "../../../src/store/sqlite";
import type { Store } from "../../../src/store/types";

describe("SqliteStore", () => {
  it("can be assigned to Store", () => {
    const db = openDb(":memory:");
    const store: Store = new SqliteStore(db);
    expect(store.issues.all()).toEqual([]);
    expect(store.transitions.all()).toEqual([]);
    expect(store.sprints.all()).toEqual([]);
    expect(store.statuses.all()).toEqual([]);
    expect(store.snapshots.all()).toEqual([]);
    expect(store.appConfig.get("k")).toBeNull();
    expect(store.syncLog.lastByProject("X")).toBeNull();
  });

  it("transaction returns callback's value and rolls back on throw", () => {
    const db = openDb(":memory:");
    const store = new SqliteStore(db);
    expect(store.transaction(() => 42)).toBe(42);
    expect(() => store.transaction(() => {
      store.statuses.upsertMany([{ name: "X", categoryKey: "new", categoryName: "X" }]);
      throw new Error("boom");
    })).toThrow("boom");
    expect(store.statuses.all()).toEqual([]);
  });
});
```

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Implémenter `src/store/sqlite/index.ts`**

```typescript
// src/store/sqlite/index.ts
import type Database from "better-sqlite3";
import type { Store } from "../types";
import { IssuesSqlite } from "./issues";
import { TransitionsSqlite } from "./transitions";
import { SprintsSqlite } from "./sprints";
import { StatusesSqlite } from "./statuses";
import { IssueFieldChangesSqlite } from "./issueFieldChanges";
import { IssueSprintsSqlite } from "./issueSprints";
import { SnapshotsSqlite } from "./snapshots";
import { AppConfigSqlite } from "./appConfig";
import { SyncLogSqlite } from "./syncLog";

export class SqliteStore implements Store {
  readonly issues: IssuesSqlite;
  readonly transitions: TransitionsSqlite;
  readonly sprints: SprintsSqlite;
  readonly statuses: StatusesSqlite;
  readonly issueFieldChanges: IssueFieldChangesSqlite;
  readonly issueSprints: IssueSprintsSqlite;
  readonly snapshots: SnapshotsSqlite;
  readonly appConfig: AppConfigSqlite;
  readonly syncLog: SyncLogSqlite;

  constructor(private readonly db: Database.Database) {
    this.issues = new IssuesSqlite(db);
    this.transitions = new TransitionsSqlite(db);
    this.sprints = new SprintsSqlite(db);
    this.statuses = new StatusesSqlite(db);
    this.issueFieldChanges = new IssueFieldChangesSqlite(db);
    this.issueSprints = new IssueSprintsSqlite(db);
    this.snapshots = new SnapshotsSqlite(db);
    this.appConfig = new AppConfigSqlite(db);
    this.syncLog = new SyncLogSqlite(db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export { openDb } from "./schema";
```

- [ ] **Step 4 : Run all store tests → tous PASS**

Run: `npx vitest run tests/store`
Expected: tout vert.

- [ ] **Step 5 : Commit**

```bash
git add src/store/sqlite/index.ts tests/store/sqlite/facade.test.ts
git commit -m "feat(store): expose SqliteStore facade implementing Store (ticket 050)"
```

---

## Phase 3 — MetricsContext + nouvelle signature

### Task 3.1: Helper de test `createTestContext`

**Pourquoi :** Toutes les migrations de métriques (Phase 4) vont remplacer `metric.compute(db, config)` par un appel via contexte. Factoriser maintenant évite la duplication.

**Files:**
- Create: `tests/_helpers/createTestContext.ts`

- [ ] **Step 1 : Implémenter le helper (placeholder qui sera complété en Task 3.2)**

```typescript
// tests/_helpers/createTestContext.ts
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";
import type { MetricsContext } from "../../src/metrics/context";
import { SqliteStore } from "../../src/store/sqlite";
import { buildMetricsContext } from "../../src/metrics/context";

export function createTestContext(db: Database.Database, config: MetricConfig): MetricsContext {
  return buildMetricsContext(new SqliteStore(db), config);
}
```

- [ ] **Step 2 : Commit (compile pas encore — `MetricsContext` créé en Task 3.2)**

Pas de run de test ici, fichier seul. Sera testé indirectement par les tests de métriques en Phase 4.

```bash
git add tests/_helpers/createTestContext.ts
git commit -m "test: add createTestContext helper for store-based metric tests (ticket 050)"
```

### Task 3.2: Implémenter `MetricsContext` + nouvelle signature `Metric<T>`

**Files:**
- Create: `src/metrics/context.ts`
- Create: `tests/metrics/context.test.ts`
- Modify: `src/metrics/types.ts` (changer signature `Metric<T>`)

- [ ] **Step 1 : Test**

```typescript
// tests/metrics/context.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/sqlite/schema";
import { SqliteStore } from "../../src/store/sqlite";
import { buildMetricsContext } from "../../src/metrics/context";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
let store: SqliteStore;

const baseConfig: MetricConfig = {
  todoStatuses: ["To Do"],
  devStartStatuses: ["In Progress"],
  inProgressStatuses: ["In Progress", "Review"],
  activeStatuses: ["In Progress"],
  queueStatuses: ["Review"],
  doneStatuses: ["Done"],
  bugIssueTypes: ["Bug"],
  excludeIssueTypes: [],
  cutoffDate: "2026-01-01",
  estimation: { method: "time" },
};

beforeEach(() => {
  db = openDb(":memory:");
  store = new SqliteStore(db);
  store.issues.upsertMany([
    { key: "ABC-1", summary: "x", issueType: "Story",
      createdAt: "2026-01-01T00:00:00Z", resolvedAt: null,
      currentStatus: "Done", assignee: null, priority: null,
      currentSprintId: null, originalEstimateSeconds: null,
      storyPoints: null, sizeLabel: null },
    { key: "ABC-2", summary: "y", issueType: "Story",
      createdAt: "2026-01-01T00:00:00Z", resolvedAt: null,
      currentStatus: "In Progress", assignee: null, priority: null,
      currentSprintId: null, originalEstimateSeconds: null,
      storyPoints: null, sizeLabel: null },
  ]);
  store.transitions.replaceForIssues([
    { key: "ABC-1", rows: [
      { issueKey: "ABC-1", fromStatus: null,           toStatus: "To Do",       transitionedAt: "2026-01-02T00:00:00Z" },
      { issueKey: "ABC-1", fromStatus: "To Do",        toStatus: "In Progress", transitionedAt: "2026-01-03T00:00:00Z" },
      { issueKey: "ABC-1", fromStatus: "In Progress",  toStatus: "Done",        transitionedAt: "2026-01-05T00:00:00Z" },
    ]},
    { key: "ABC-2", rows: [
      { issueKey: "ABC-2", fromStatus: null,    toStatus: "To Do",       transitionedAt: "2026-01-02T00:00:00Z" },
      { issueKey: "ABC-2", fromStatus: "To Do", toStatus: "In Progress", transitionedAt: "2026-01-03T00:00:00Z" },
    ]},
  ]);
});

describe("buildMetricsContext", () => {
  it("indexes issues by key", () => {
    const ctx = buildMetricsContext(store, baseConfig);
    expect(ctx.issueByKey.get("ABC-1")?.issueType).toBe("Story");
  });

  it("indexes transitions by issue key", () => {
    const ctx = buildMetricsContext(store, baseConfig);
    expect(ctx.transitionsByIssue.get("ABC-1")?.length).toBe(3);
  });

  it("indexes transitions by toStatus", () => {
    const ctx = buildMetricsContext(store, baseConfig);
    expect(ctx.transitionsByToStatus.get("Done")?.length).toBe(1);
  });

  it("computes deliveredAt from doneStatuses", () => {
    const ctx = buildMetricsContext(store, baseConfig);
    expect(ctx.deliveredAt.get("ABC-1")).toBe("2026-01-05T00:00:00Z");
    expect(ctx.deliveredAt.get("ABC-2")).toBeUndefined();
  });

  it("filters cycleTimePopulation to delivered + dev-started issues", () => {
    const ctx = buildMetricsContext(store, baseConfig);
    expect(ctx.cycleTimePopulation.map((s) => s.issueKey)).toEqual(["ABC-1"]);
    expect(ctx.cycleTimePopulation[0]).toMatchObject({
      issueKey: "ABC-1",
      startedAt: "2026-01-03T00:00:00Z",
      doneAt: "2026-01-05T00:00:00Z",
    });
  });

  it("respects cutoffDate filter on cycleTimePopulation", () => {
    const ctx = buildMetricsContext(store, { ...baseConfig, cutoffDate: "2026-01-10" });
    expect(ctx.cycleTimePopulation).toEqual([]);
  });

  it("respects excludeIssueTypes (filter on issues array)", () => {
    const ctx = buildMetricsContext(store, { ...baseConfig, excludeIssueTypes: ["Story"] });
    expect(ctx.issues).toEqual([]);
    expect(ctx.cycleTimePopulation).toEqual([]);
  });

  it("respects windowEndDate on cycleTimePopulation", () => {
    const ctx = buildMetricsContext(store, { ...baseConfig, windowEndDate: "2026-01-04T00:00:00Z" });
    expect(ctx.cycleTimePopulation).toEqual([]);
  });
});
```

- [ ] **Step 2 : Run → FAIL (module absent)**

Run: `npx vitest run tests/metrics/context.test.ts`
Expected: FAIL

- [ ] **Step 3 : Implémenter `src/metrics/context.ts`**

```typescript
// src/metrics/context.ts
import type { ReadStore, IssueRecord, TransitionRecord } from "../store/types";
import type { MetricConfig } from "./types";
import { isoWeek, workingDaysBetween } from "./utils";

export interface CycleTimeSample {
  issueKey: string;
  startedAt: string;
  doneAt: string;
}

export interface MetricsContext {
  issues: IssueRecord[];
  transitions: TransitionRecord[];

  issueByKey: Map<string, IssueRecord>;
  transitionsByIssue: Map<string, TransitionRecord[]>;
  transitionsByToStatus: Map<string, TransitionRecord[]>;

  deliveredAt: Map<string, string>;
  cycleTimePopulation: CycleTimeSample[];

  workingDaysBetween: typeof workingDaysBetween;
  isoWeek: typeof isoWeek;

  config: MetricConfig;
  store: ReadStore;
}

export function buildMetricsContext(store: ReadStore, config: MetricConfig): MetricsContext {
  const excludeSet = new Set(config.excludeIssueTypes ?? []);
  const issues = store.issues.all().filter((i) => !excludeSet.has(i.issueType));
  const issueKeys = new Set(issues.map((i) => i.key));

  const allTransitions = store.transitions.all();
  const transitions = allTransitions.filter((t) => issueKeys.has(t.issueKey));

  const issueByKey = new Map<string, IssueRecord>();
  for (const i of issues) { issueByKey.set(i.key, i); }

  const transitionsByIssue = new Map<string, TransitionRecord[]>();
  const transitionsByToStatus = new Map<string, TransitionRecord[]>();
  for (const t of transitions) {
    let perIssue = transitionsByIssue.get(t.issueKey);
    if (!perIssue) { perIssue = []; transitionsByIssue.set(t.issueKey, perIssue); }
    perIssue.push(t);
    let perStatus = transitionsByToStatus.get(t.toStatus);
    if (!perStatus) { perStatus = []; transitionsByToStatus.set(t.toStatus, perStatus); }
    perStatus.push(t);
  }
  // garantir l'ordre chronologique par issue (suit l'ordre du SELECT mais on rebuild)
  for (const list of transitionsByIssue.values()) {
    list.sort((a, b) => a.transitionedAt.localeCompare(b.transitionedAt) || a.id - b.id);
  }

  const doneSet = new Set(config.doneStatuses);
  const deliveredAt = new Map<string, string>();
  for (const [key, list] of transitionsByIssue) {
    const first = list.find((t) => doneSet.has(t.toStatus));
    if (first) { deliveredAt.set(key, first.transitionedAt); }
  }

  const devStartSet = new Set(config.devStartStatuses);
  const cutoff = config.cutoffDate;
  const windowEnd = config.windowEndDate;
  const cycleTimePopulation: CycleTimeSample[] = [];
  for (const [key, list] of transitionsByIssue) {
    const doneAt = deliveredAt.get(key);
    if (!doneAt) { continue; }
    if (cutoff && doneAt < cutoff) { continue; }
    if (windowEnd && doneAt > windowEnd) { continue; }
    const devStart = list.find((t) => devStartSet.has(t.toStatus));
    if (!devStart) { continue; }
    cycleTimePopulation.push({ issueKey: key, startedAt: devStart.transitionedAt, doneAt });
  }
  cycleTimePopulation.sort((a, b) => a.issueKey.localeCompare(b.issueKey));

  return {
    issues, transitions,
    issueByKey, transitionsByIssue, transitionsByToStatus,
    deliveredAt, cycleTimePopulation,
    workingDaysBetween, isoWeek,
    config, store,
  };
}
```

- [ ] **Step 4 : Mettre à jour `src/metrics/types.ts` avec la nouvelle signature**

Trouver l'interface `Metric<T>` dans `src/metrics/types.ts` et la remplacer :

```typescript
// AVANT
import type Database from "better-sqlite3";
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}

// APRÈS
import type { MetricsContext } from "./context";
export interface Metric<T> {
  name: string;
  description: string;
  compute(ctx: MetricsContext): T;
}
```

- [ ] **Step 5 : Run context test → PASS** (les tests de métriques sont cassés, c'est attendu)

Run: `npx vitest run tests/metrics/context.test.ts`
Expected: PASS

- [ ] **Step 6 : Commit**

```bash
git add src/metrics/context.ts src/metrics/types.ts tests/metrics/context.test.ts
git commit -m "feat(metrics): add MetricsContext + new Metric<T> signature compute(ctx) (ticket 050)"
```

**Note :** À ce stade, `tsc` casse partout (les 25 métriques utilisent encore l'ancienne signature). On continue rapidement avec la Phase 4 — chaque tâche refait passer un sous-ensemble.

---

## Phase 4 — Migration des 25 métriques

**Pré-requis pour chaque tâche :**

1. Lire le fichier `src/metrics/<name>.ts` actuel pour comprendre le SQL.
2. Lire `tests/metrics/<name>.test.ts` actuel — il est la **spec de régression**.
3. Adapter UNIQUEMENT le test : remplacer `metric.compute(db, config)` par `metric.compute(createTestContext(db, config))` (helper créé en Task 3.1).
4. Réécrire `compute(ctx)` en TypeScript pur, sans SQL.
5. Tests doivent passer inchangés (modulo l'appel ci-dessus).

**Repère :** la migration de `leadTime` (Task 4.1) sert d'exemple complet. Les tâches suivantes décrivent uniquement les particularités.

### Task 4.1: Migrer `leadTime` (exemple canonique complet)

**Files:**
- Modify: `src/metrics/leadTime.ts`
- Modify: `tests/metrics/leadTime.test.ts`

- [ ] **Step 1 : Adapter le test**

Dans `tests/metrics/leadTime.test.ts`, importer le helper et remplacer chaque appel :

```typescript
import { createTestContext } from "../_helpers/createTestContext";

// Avant : leadTimeMetric.compute(db, config)
// Après : leadTimeMetric.compute(createTestContext(db, config))
```

- [ ] **Step 2 : Run → FAIL (compute signature change pas encore appliqué)**

Run: `npx vitest run tests/metrics/leadTime.test.ts`
Expected: FAIL

- [ ] **Step 3 : Réécrire `src/metrics/leadTime.ts`**

```typescript
// src/metrics/leadTime.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, statsFromDays } from "./utils";

export interface LeadTimeIssue {
  issueKey: string;
  todoAt: string;
  resolvedAt: string;
  leadTimeDays: number;
}

export interface LeadTimeSummary extends DurationStats {
  issues: LeadTimeIssue[];
}

export const leadTimeMetric: Metric<LeadTimeSummary> = {
  name: "lead-time",
  description: "Délai entre l'entrée en TODO et la livraison team-done",

  compute(ctx: MetricsContext): LeadTimeSummary {
    const todoSet = new Set(ctx.config.todoStatuses);
    const issues: LeadTimeIssue[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      const list = ctx.transitionsByIssue.get(sample.issueKey)!;
      const todoTransition = list.find((t) => todoSet.has(t.toStatus));
      if (!todoTransition) { continue; }
      const todoAt = todoTransition.transitionedAt;
      if (sample.doneAt < todoAt) { continue; }
      issues.push({
        issueKey: sample.issueKey,
        todoAt,
        resolvedAt: sample.doneAt,
        leadTimeDays: ctx.workingDaysBetween(todoAt, sample.doneAt),
      });
    }
    issues.sort((a, b) => a.issueKey.localeCompare(b.issueKey));
    const stats = statsFromDays(
      issues.map((i) => i.leadTimeDays),
      ctx.config.excludeOutliers !== false,
    );
    return { ...stats, issues };
  },
};
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/metrics/leadTime.ts tests/metrics/leadTime.test.ts
git commit -m "refactor(metrics): migrate lead-time to MetricsContext (ticket 050)"
```

### Task 4.2: Migrer `cycleTime`

**Files:**
- Modify: `src/metrics/cycleTime.ts`
- Modify: `tests/metrics/cycleTime.test.ts`

**Particularité :** identique à `leadTime` mais débute à `startedAt` (dev start) au lieu de `todoAt`. La fenêtre = `workingDaysBetween(startedAt, doneAt)`.

- [ ] **Step 1 : Adapter le test (createTestContext)**

- [ ] **Step 2 : Run → FAIL**

- [ ] **Step 3 : Réécrire `compute`**

```typescript
// src/metrics/cycleTime.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, statsFromDays } from "./utils";

export interface CycleTimeIssue {
  issueKey: string;
  startedAt: string;
  resolvedAt: string;
  cycleTimeDays: number;
}

export interface CycleTimeSummary extends DurationStats {
  issues: CycleTimeIssue[];
}

export const cycleTimeMetric: Metric<CycleTimeSummary> = {
  name: "cycle-time",
  description: "Temps de dev (1ère entrée en In Progress → team-done)",

  compute(ctx: MetricsContext): CycleTimeSummary {
    const issues: CycleTimeIssue[] = ctx.cycleTimePopulation.map((s) => ({
      issueKey: s.issueKey,
      startedAt: s.startedAt,
      resolvedAt: s.doneAt,
      cycleTimeDays: ctx.workingDaysBetween(s.startedAt, s.doneAt),
    }));
    issues.sort((a, b) => a.issueKey.localeCompare(b.issueKey));
    const stats = statsFromDays(
      issues.map((i) => i.cycleTimeDays),
      ctx.config.excludeOutliers !== false,
    );
    return { ...stats, issues };
  },
};
```

- [ ] **Step 4 : Run → PASS**

- [ ] **Step 5 : Commit**

```bash
git add src/metrics/cycleTime.ts tests/metrics/cycleTime.test.ts
git commit -m "refactor(metrics): migrate cycle-time to MetricsContext (ticket 050)"
```

### Task 4.3: Migrer `leadTimeBySize`

**Files:**
- Modify: `src/metrics/leadTimeBySize.ts`
- Modify: `tests/metrics/leadTimeBySize.test.ts`

**Particularité :** bucketize chaque issue (cf `bucketize()` dans `utils.ts`) puis `statsFromDays` par bucket. Type bug = bucket BUG.

- [ ] **Step 1-2 : Adapter test + run FAIL**

- [ ] **Step 3 : Réécrire `compute`**

```typescript
// src/metrics/leadTimeBySize.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import {
  type DurationStats, type SizeBucket, BUCKET_ORDER,
  statsFromDays, bucketize, getBucketLabels,
} from "./utils";

export interface LeadTimeBySizeBucketResult {
  label: string;
  stats: DurationStats;
}

export type LeadTimeBySizeResult = Record<SizeBucket, LeadTimeBySizeBucketResult>;

export const leadTimeBySizeMetric: Metric<LeadTimeBySizeResult> = {
  name: "lead-time-by-size",
  description: "Lead time agrégé par bucket d'estimation",

  compute(ctx: MetricsContext): LeadTimeBySizeResult {
    const todoSet = new Set(ctx.config.todoStatuses);
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const buckets: Record<SizeBucket, number[]> = {
      XS: [], S: [], M: [], L: [], XL: [], BUG: [], UNESTIMATED: [],
    };
    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      const list = ctx.transitionsByIssue.get(sample.issueKey)!;
      const todoTransition = list.find((t) => todoSet.has(t.toStatus));
      if (!todoTransition) { continue; }
      if (sample.doneAt < todoTransition.transitionedAt) { continue; }
      const bucket = bucketize(issue, bugSet.has(issue.issueType), ctx.config.estimation);
      buckets[bucket].push(ctx.workingDaysBetween(todoTransition.transitionedAt, sample.doneAt));
    }
    const labels = getBucketLabels(ctx.config.estimation);
    const out = {} as LeadTimeBySizeResult;
    const excludeOutliers = ctx.config.excludeOutliers !== false;
    for (const b of BUCKET_ORDER) {
      out[b] = { label: labels[b], stats: statsFromDays(buckets[b], excludeOutliers) };
    }
    return out;
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/leadTimeBySize.ts tests/metrics/leadTimeBySize.test.ts
git commit -m "refactor(metrics): migrate lead-time-by-size to MetricsContext (ticket 050)"
```

### Task 4.4: Migrer `cycleTimeBySize`

**Files:** `src/metrics/cycleTimeBySize.ts`, `tests/metrics/cycleTimeBySize.test.ts`

**Particularité :** identique à `leadTimeBySize` mais on utilise `sample.startedAt` au lieu du todo transition.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`**

```typescript
// src/metrics/cycleTimeBySize.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import {
  type DurationStats, type SizeBucket, BUCKET_ORDER,
  statsFromDays, bucketize, getBucketLabels,
} from "./utils";

export interface CycleTimeBySizeBucketResult { label: string; stats: DurationStats; }
export type CycleTimeBySizeResult = Record<SizeBucket, CycleTimeBySizeBucketResult>;

export const cycleTimeBySizeMetric: Metric<CycleTimeBySizeResult> = {
  name: "cycle-time-by-size",
  description: "Cycle time agrégé par bucket d'estimation",

  compute(ctx: MetricsContext): CycleTimeBySizeResult {
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const buckets: Record<SizeBucket, number[]> = {
      XS: [], S: [], M: [], L: [], XL: [], BUG: [], UNESTIMATED: [],
    };
    for (const sample of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(sample.issueKey);
      if (!issue) { continue; }
      const bucket = bucketize(issue, bugSet.has(issue.issueType), ctx.config.estimation);
      buckets[bucket].push(ctx.workingDaysBetween(sample.startedAt, sample.doneAt));
    }
    const labels = getBucketLabels(ctx.config.estimation);
    const out = {} as CycleTimeBySizeResult;
    const excludeOutliers = ctx.config.excludeOutliers !== false;
    for (const b of BUCKET_ORDER) {
      out[b] = { label: labels[b], stats: statsFromDays(buckets[b], excludeOutliers) };
    }
    return out;
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/cycleTimeBySize.ts tests/metrics/cycleTimeBySize.test.ts
git commit -m "refactor(metrics): migrate cycle-time-by-size to MetricsContext (ticket 050)"
```

### Task 4.5: Migrer `leadTimeNormalized`

**Files:** `src/metrics/leadTimeNormalized.ts`, `tests/metrics/leadTimeNormalized.test.ts`

**Particularité :** division `leadTimeDays / estimatedDays` par bucket. Exclut BUG et UNESTIMATED. Lire l'implémentation actuelle pour récupérer la formule de normalisation exacte (et la `WeightedAverage` éventuelle). Garder identique côté logique, remplacer juste la source SQL par parcours de `ctx.cycleTimePopulation`.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : Réécrire `compute(ctx)`** — pattern : pour chaque issue de `cycleTimePopulation`, calculer la durée brute (lead time = `workingDaysBetween(todoAt, doneAt)`), récupérer `estimatedDays` via la même fonction utilitaire que l'actuelle (ne pas la dupliquer — `estimation.method === "time"` → `originalEstimateSeconds / SECONDS_PER_DAY`, `"story-points"` → `storyPoints`, etc.), pousser le ratio dans le bucket de l'issue. Statistiques finales identiques (statsFromDays sur les ratios par bucket).

  Reproduire au plus près l'output actuel pour que le test passe sans modification.

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/leadTimeNormalized.ts tests/metrics/leadTimeNormalized.test.ts
git commit -m "refactor(metrics): migrate lead-time-normalized to MetricsContext (ticket 050)"
```

### Task 4.6: Migrer `cycleTimeNormalized`

**Files:** `src/metrics/cycleTimeNormalized.ts`, `tests/metrics/cycleTimeNormalized.test.ts`

**Particularité :** même schéma que `leadTimeNormalized` avec `cycleTimeDays = workingDaysBetween(startedAt, doneAt)`.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : Réécrire `compute(ctx)` selon pattern leadTimeNormalized.**

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/cycleTimeNormalized.ts tests/metrics/cycleTimeNormalized.test.ts
git commit -m "refactor(metrics): migrate cycle-time-normalized to MetricsContext (ticket 050)"
```

### Task 4.7: Migrer `throughput`

**Files:** `src/metrics/throughput.ts`, `tests/metrics/throughput.test.ts`

**Particularité :** compte les livraisons hebdomadaires (`isoWeek(doneAt)`). Source = `ctx.deliveredAt`. Filtrer par `cutoffDate` et exclure les bugs (`config.bugIssueTypes`).

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`**

```typescript
// src/metrics/throughput.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { avg } from "./utils";

export interface ThroughputWeek { week: string; count: number; }
export interface ThroughputResult { byWeek: ThroughputWeek[]; avgPerWeek: number; }

export const throughputMetric: Metric<ThroughputResult> = {
  name: "throughput",
  description: "Nombre de livraisons (non-bug) par semaine ISO",

  compute(ctx: MetricsContext): ThroughputResult {
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const cutoff = ctx.config.cutoffDate;
    const counts = new Map<string, number>();
    for (const [key, doneAt] of ctx.deliveredAt) {
      if (cutoff && doneAt < cutoff) { continue; }
      const issue = ctx.issueByKey.get(key);
      if (!issue || bugSet.has(issue.issueType)) { continue; }
      const w = ctx.isoWeek(doneAt);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const byWeek: ThroughputWeek[] = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, count]) => ({ week, count }));
    return { byWeek, avgPerWeek: avg(byWeek.map((w) => w.count)) };
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/throughput.ts tests/metrics/throughput.test.ts
git commit -m "refactor(metrics): migrate throughput to MetricsContext (ticket 050)"
```

### Task 4.8: Migrer `bugThroughput`

**Files:** `src/metrics/bugThroughput.ts`, `tests/metrics/bugThroughput.test.ts`

**Particularité :** même squelette que `throughput` mais filtrage inverse (`bugSet.has(issue.issueType)`).

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : Réécrire `compute(ctx)` en filtrant `bugSet.has(issue.issueType)` (au lieu de `!bugSet.has(...)`)**

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/bugThroughput.ts tests/metrics/bugThroughput.test.ts
git commit -m "refactor(metrics): migrate bug-throughput to MetricsContext (ticket 050)"
```

### Task 4.9: Migrer `throughputWeighted`

**Files:** `src/metrics/throughputWeighted.ts`, `tests/metrics/throughputWeighted.test.ts`

**Particularité :** somme `estimatedDays` par semaine (au lieu d'un compte). `disabled: true` si `estimation.method === "t-shirt"` ou `"none"`. Unit dérivée de `estimation.method` (`"j-h"`, `"SP"`, `"pts"`).

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — parcours `ctx.deliveredAt`, pour chaque livraison non-bug : récupérer `estimatedDays` (helper interne identique à l'actuel), additionner par `isoWeek`. Retourner `{ byWeek, unit, disabled }`.

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/throughputWeighted.ts tests/metrics/throughputWeighted.test.ts
git commit -m "refactor(metrics): migrate throughput-weighted to MetricsContext (ticket 050)"
```

### Task 4.10: Migrer `bugCycleTime`

**Files:** `src/metrics/bugCycleTime.ts`, `tests/metrics/bugCycleTime.test.ts`

**Particularité :** identique à `cycleTime` mais filtré aux bugs. Filtrer `cycleTimePopulation` sur `bugSet.has(issue.issueType)`.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`**

```typescript
// src/metrics/bugCycleTime.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, statsFromDays } from "./utils";

export interface BugCycleTimeIssue {
  issueKey: string; startedAt: string; resolvedAt: string; cycleTimeDays: number;
}
export interface BugCycleTimeSummary extends DurationStats { issues: BugCycleTimeIssue[]; }

export const bugCycleTimeMetric: Metric<BugCycleTimeSummary> = {
  name: "bug-cycle-time",
  description: "Cycle time des bugs (dev start → team-done)",

  compute(ctx: MetricsContext): BugCycleTimeSummary {
    const bugSet = new Set(ctx.config.bugIssueTypes);
    const issues: BugCycleTimeIssue[] = [];
    for (const s of ctx.cycleTimePopulation) {
      const issue = ctx.issueByKey.get(s.issueKey);
      if (!issue || !bugSet.has(issue.issueType)) { continue; }
      issues.push({
        issueKey: s.issueKey, startedAt: s.startedAt, resolvedAt: s.doneAt,
        cycleTimeDays: ctx.workingDaysBetween(s.startedAt, s.doneAt),
      });
    }
    issues.sort((a, b) => a.issueKey.localeCompare(b.issueKey));
    const stats = statsFromDays(issues.map((i) => i.cycleTimeDays), ctx.config.excludeOutliers !== false);
    return { ...stats, issues };
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/bugCycleTime.ts tests/metrics/bugCycleTime.test.ts
git commit -m "refactor(metrics): migrate bug-cycle-time to MetricsContext (ticket 050)"
```

### Task 4.11: Migrer `wip`

**Files:** `src/metrics/wip.ts`, `tests/metrics/wip.test.ts`

**Particularité :** WIP point-in-time = nombre d'issues dont `currentStatus ∈ inProgressStatuses`. Lire les issues via `ctx.issues`. Pas dépendant de `cycleTimePopulation`.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`**

```typescript
// src/metrics/wip.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";

export interface WipResult { currentWip: number; issueKeys: string[]; }

export const wipMetric: Metric<WipResult> = {
  name: "wip",
  description: "Issues actuellement en in-progress (sprint actif si scoping)",

  compute(ctx: MetricsContext): WipResult {
    const inProg = new Set(ctx.config.inProgressStatuses);
    const keys = ctx.issues.filter((i) => inProg.has(i.currentStatus)).map((i) => i.key).sort();
    return { currentWip: keys.length, issueKeys: keys };
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/wip.ts tests/metrics/wip.test.ts
git commit -m "refactor(metrics): migrate wip to MetricsContext (ticket 050)"
```

### Task 4.12: Migrer `wipPerRole`

**Files:** `src/metrics/wipPerRole.ts`, `tests/metrics/wipPerRole.test.ts`

**Particularité :** WIP point-in-time éclaté par rôle (`devStatuses` / `qaStatuses` / `poStatuses`). Aussi exporte `computeHistoricWipPerRole` utilisé par snapshots — vérifier l'export.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** + (si applicable) adapter `computeHistoricWipPerRole` à prendre `ctx` (ou `(transitions, atDate, roleStatuses)` purement). Reproduire à l'identique.

```typescript
// src/metrics/wipPerRole.ts (compute)
import type { Metric } from "./types";
import type { MetricsContext } from "./context";

export interface RoleWip { count: number; issueKeys: string[]; }
export interface WipPerRoleResult { byRole: { dev: RoleWip; qa: RoleWip; po: RoleWip }; }

export const wipPerRoleMetric: Metric<WipPerRoleResult> = {
  name: "wip-per-role",
  description: "WIP éclaté par rôle (dev/qa/po) point-in-time",

  compute(ctx: MetricsContext): WipPerRoleResult {
    const dev = new Set(ctx.config.devStatuses ?? []);
    const qa  = new Set(ctx.config.qaStatuses  ?? []);
    const po  = new Set(ctx.config.poStatuses  ?? []);
    const collect = (set: Set<string>): RoleWip => {
      const keys = ctx.issues.filter((i) => set.has(i.currentStatus)).map((i) => i.key).sort();
      return { count: keys.length, issueKeys: keys };
    };
    return { byRole: { dev: collect(dev), qa: collect(qa), po: collect(po) } };
  },
};

export function computeHistoricWipPerRole(/* ... voir signature actuelle ... */): /* ... */ {
  // Reproduire la logique actuelle, remplacer accès db par parcours de transitions/issues fournies en paramètre.
}
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/wipPerRole.ts tests/metrics/wipPerRole.test.ts
git commit -m "refactor(metrics): migrate wip-per-role to MetricsContext (ticket 050)"
```

### Task 4.13: Migrer `flowEfficiency`

**Files:** `src/metrics/flowEfficiency.ts`, `tests/metrics/flowEfficiency.test.ts`

**Particularité :** pour chaque issue de `cycleTimePopulation`, calculer le temps cumulé en `activeStatuses` vs `queueStatuses` entre `startedAt` et `doneAt`. Réutiliser le pattern de `computeRoleDays` (dans `utils.ts`) en l'adaptant à 2 catégories actives/queue. Output : aggregate ratio + median + P15.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`**

```typescript
// src/metrics/flowEfficiency.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { percentile } from "./utils";

export interface FlowEfficiencyResult {
  count: number;
  aggregateFlowEfficiency: number;
  medianFlowEfficiency: number;
  p15FlowEfficiency: number;
}

export const flowEfficiencyMetric: Metric<FlowEfficiencyResult> = {
  name: "flow-efficiency",
  description: "Ratio temps actif / (actif + queue) sur la fenêtre cycle-time",

  compute(ctx: MetricsContext): FlowEfficiencyResult {
    const activeSet = new Set(ctx.config.activeStatuses);
    const queueSet = new Set(ctx.config.queueStatuses);
    const ratios: number[] = [];
    let totalActive = 0, totalQueue = 0;
    for (const s of ctx.cycleTimePopulation) {
      const list = ctx.transitionsByIssue.get(s.issueKey)!;
      const inWindow = list.filter((t) => t.transitionedAt >= s.startedAt && t.transitionedAt <= s.doneAt);
      let active = 0, queue = 0;
      for (let i = 0; i < inWindow.length; i++) {
        const start = inWindow[i].transitionedAt;
        const end = i + 1 < inWindow.length ? inWindow[i + 1].transitionedAt : s.doneAt;
        if (end <= start) { continue; }
        const days = ctx.workingDaysBetween(start, end);
        const status = inWindow[i].toStatus;
        if (activeSet.has(status)) { active += days; }
        else if (queueSet.has(status)) { queue += days; }
      }
      const total = active + queue;
      if (total > 0) {
        ratios.push(active / total);
        totalActive += active;
        totalQueue += queue;
      }
    }
    const aggregate = totalActive + totalQueue > 0 ? totalActive / (totalActive + totalQueue) : 0;
    const sorted = [...ratios].sort((a, b) => a - b);
    return {
      count: ratios.length,
      aggregateFlowEfficiency: aggregate,
      medianFlowEfficiency: percentile(sorted, 50),
      p15FlowEfficiency: percentile(sorted, 15),
    };
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/flowEfficiency.ts tests/metrics/flowEfficiency.test.ts
git commit -m "refactor(metrics): migrate flow-efficiency to MetricsContext (ticket 050)"
```

### Task 4.14: Migrer `agingWip`

**Files:** `src/metrics/agingWip.ts`, `tests/metrics/agingWip.test.ts`

**Particularité :** pour chaque issue actuellement en in-progress, calcule l'âge depuis sa première entrée en `devStartStatuses`. Compare aux quantiles historiques (P50/P85/P95) du `cycle-time` cumulé (passer par une variante de `cycleTimePopulation` sur tout l'historique — utiliser `ctx.cycleTimePopulation` directement si la config ne pose pas de fenêtre, ou recomputer une population cumulative pour la référence). Output : `riskCounts`.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire la logique actuelle :
  - Issues actuellement en in-progress (`ctx.issues.filter((i) => inProg.has(i.currentStatus))`)
  - Pour chaque, retrouver `devStart` dans ses transitions (`ctx.transitionsByIssue.get(key).find(t => devStartSet.has(t.toStatus))`)
  - Âge en jours ouvrés depuis `devStart.transitionedAt` jusqu'à `now()` (utiliser `clock.now()` via import direct, comme métrique actuelle)
  - Comparer aux P50/P85/P95 calculés sur `cycleTimePopulation` (cycle time cumulé)
  - Classifier (green/yellow/red/critical selon seuils existants)

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/agingWip.ts tests/metrics/agingWip.test.ts
git commit -m "refactor(metrics): migrate aging-wip to MetricsContext (ticket 050)"
```

### Task 4.15: Migrer `forecast` (Monte Carlo)

**Files:** `src/metrics/forecast.ts`, `tests/metrics/forecast.test.ts`

**Particularité :** rolling 12 semaines de throughput → MC. PRNG déjà injecté via `random.ts`. Source = `ctx.deliveredAt` (filtré non-bug + 12 dernières semaines). Pas de SQL.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire la logique actuelle, en remplaçant les requêtes `db.prepare(...)` par parcours de `ctx.deliveredAt` filtré sur les 12 dernières semaines avant `now()`. PRNG via import `random` inchangé.

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/forecast.ts tests/metrics/forecast.test.ts
git commit -m "refactor(metrics): migrate forecast to MetricsContext (ticket 050)"
```

### Task 4.16: Migrer `devTimeAllocation`

**Files:** `src/metrics/devTimeAllocation.ts`, `tests/metrics/devTimeAllocation.test.ts`

**Particularité :** par semaine, calcule la part feature vs bug en jours-cycle. Inclut le WIP : pour les issues en cours, `done_at` fictif = `now()`. `avgBugRatio` pondéré par volume.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire la logique actuelle :
  - Pour chaque issue dans `cycleTimePopulation` ∪ issues en cours (avec `done_at = now()`) → fenêtre `(startedAt, doneAt)` en `workingDaysBetween`
  - Distribuer les jours dans la semaine de `startedAt` (ou répartir selon logique existante — vérifier dans le code actuel)
  - Distinguer feature vs bug par `bugSet.has(issue.issueType)`
  - Output : `byWeek + avgBugRatio`

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/devTimeAllocation.ts tests/metrics/devTimeAllocation.test.ts
git commit -m "refactor(metrics): migrate dev-time-allocation to MetricsContext (ticket 050)"
```

### Task 4.17: Migrer `bugBacklog`

**Files:** `src/metrics/bugBacklog.ts`, `tests/metrics/bugBacklog.test.ts`

**Particularité :** point-in-time : nombre de bugs ouverts = bugs dont `currentStatus ∉ doneStatuses`. Net flow par semaine (closed − created). Source = `ctx.issues` filtrés bugs + `ctx.transitionsByIssue` pour détecter les passages en done.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire la logique actuelle :
  - `openCount = ctx.issues.filter((i) => bugSet.has(i.issueType) && !doneSet.has(i.currentStatus)).length`
  - `created` par semaine ISO de `i.createdAt` pour les bugs (filtrer cutoff)
  - `closed` par semaine ISO de `ctx.deliveredAt.get(key)` pour les bugs livrés (filtrer cutoff)
  - `byWeek[].netFlow = closed − created`

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/bugBacklog.ts tests/metrics/bugBacklog.test.ts
git commit -m "refactor(metrics): migrate bug-backlog to MetricsContext (ticket 050)"
```

### Task 4.18: Migrer `stageTimeBreakdown`

**Files:** `src/metrics/stageTimeBreakdown.ts`, `tests/metrics/stageTimeBreakdown.test.ts`

**Particularité :** réutilise `computeRoleDays(transitions, doneAt, roles)` (helper pur, conservé dans `utils.ts`). Pour chaque `cycleTimePopulation` sample, extraire la sous-liste des transitions entre `startedAt` et `doneAt`, appeler `computeRoleDays`, agréger.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`**

```typescript
// src/metrics/stageTimeBreakdown.ts
import type { Metric } from "./types";
import type { MetricsContext } from "./context";
import { type DurationStats, computeRoleDays, statsFromDays, toRoleStatuses } from "./utils";

export interface StageTimeBreakdownResult {
  count: number;
  byRole: { dev: DurationStats; qa: DurationStats; po: DurationStats };
  avgShareByRole: { dev: number; qa: number; po: number };
}

export const stageTimeBreakdownMetric: Metric<StageTimeBreakdownResult> = {
  name: "stage-time-breakdown",
  description: "Temps médian par rôle sur la population cycle-time",

  compute(ctx: MetricsContext): StageTimeBreakdownResult {
    const roles = toRoleStatuses(ctx.config);
    const dev: number[] = [], qa: number[] = [], po: number[] = [];
    let sumDev = 0, sumQa = 0, sumPo = 0;
    for (const s of ctx.cycleTimePopulation) {
      const list = ctx.transitionsByIssue.get(s.issueKey)!
        .filter((t) => t.transitionedAt >= s.startedAt && t.transitionedAt <= s.doneAt)
        .map((t) => ({ key: s.issueKey, done_at: s.doneAt, started_at: s.startedAt, to_status: t.toStatus, transitioned_at: t.transitionedAt }));
      const r = computeRoleDays(list, s.doneAt, roles);
      dev.push(r.devDays); qa.push(r.qaDays); po.push(r.poDays);
      sumDev += r.devDays; sumQa += r.qaDays; sumPo += r.poDays;
    }
    const total = sumDev + sumQa + sumPo;
    const excludeOutliers = ctx.config.excludeOutliers !== false;
    return {
      count: dev.length,
      byRole: {
        dev: statsFromDays(dev, excludeOutliers),
        qa:  statsFromDays(qa,  excludeOutliers),
        po:  statsFromDays(po,  excludeOutliers),
      },
      avgShareByRole: total > 0
        ? { dev: sumDev / total, qa: sumQa / total, po: sumPo / total }
        : { dev: 0, qa: 0, po: 0 },
    };
  },
};
```

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/stageTimeBreakdown.ts tests/metrics/stageTimeBreakdown.test.ts
git commit -m "refactor(metrics): migrate stage-time-breakdown to MetricsContext (ticket 050)"
```

### Task 4.19: Migrer `stageThroughputGap`

**Files:** `src/metrics/stageThroughputGap.ts`, `tests/metrics/stageThroughputGap.test.ts`

**Particularité :** par semaine ISO et par rôle, compte les entrées et sorties de chaque catégorie de statut. Utilise `ctx.transitions` global avec filtrage de fenêtre (30j en snapshot, complète en CLI).

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire la logique actuelle :
  - Pour chaque transition dans la fenêtre :
    - Si `roles.qaStatuses.has(t.toStatus)` et `t.fromStatus ∉ qaStatuses` → `qaIn++` sur `isoWeek(t.transitionedAt)`
    - Si `roles.qaStatuses.has(t.fromStatus)` et `t.toStatus ∉ qaStatuses` → `qaOut++` sur même semaine
    - Idem dev/po
  - `devNet = devIn − devOut`, etc.
  - `avgNetByRole` = moyenne sur les semaines

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/stageThroughputGap.ts tests/metrics/stageThroughputGap.test.ts
git commit -m "refactor(metrics): migrate stage-throughput-gap to MetricsContext (ticket 050)"
```

### Task 4.20: Migrer `handoffRework`

**Files:** `src/metrics/handoffRework.ts`, `tests/metrics/handoffRework.test.ts`

**Particularité :** détecte les retours arrière entre rôles (qa→dev, po→qa, po→dev). Population = `cycleTimePopulation`. Pour chaque issue, parcourir ses transitions en fenêtre, compter les transitions où `fromStatus` est dans un rôle "aval" et `toStatus` dans un rôle "amont".

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire pas-à-pas la logique actuelle, mais en parcourant `ctx.transitionsByIssue.get(key)` au lieu d'une requête SQL.

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/handoffRework.ts tests/metrics/handoffRework.test.ts
git commit -m "refactor(metrics): migrate handoff-rework to MetricsContext (ticket 050)"
```

### Task 4.21: Migrer `firstTimeRight`

**Files:** `src/metrics/firstTimeRight.ts`, `tests/metrics/firstTimeRight.test.ts`

**Particularité :** % tickets traversant chaque rôle en 1 seul passage. Population = `cycleTimePopulation`. Pour chaque rôle, compter le nombre d'issues éligibles (= ayant traversé ce rôle au moins une fois) et combien l'ont fait en 1 entrée seulement.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — pour chaque issue `s` de `cycleTimePopulation`, parcourir `ctx.transitionsByIssue.get(s.issueKey)` filtrée par fenêtre `[startedAt, doneAt]`, compter les entrées dans chaque rôle, dériver `eligible / firstTimeRight / ftrRate / avgPasses` par rôle.

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/firstTimeRight.ts tests/metrics/firstTimeRight.test.ts
git commit -m "refactor(metrics): migrate first-time-right to MetricsContext (ticket 050)"
```

### Task 4.22: Migrer `reworkCost`

**Files:** `src/metrics/reworkCost.ts`, `tests/metrics/reworkCost.test.ts`

**Particularité :** coût en jours ouvrés des passes rework (≥2e passe même rôle). Statut hors rôle réinitialise le contexte. Population = `cycleTimePopulation`. Output : `count`, `reworkedCount`, `reworkRatio`, `totalReworkDays`, `avgReworkDaysPerReworkedTicket`, `reworkCostRatio`, `byWeek[]`, `bySprint[]`.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire la machine à états actuelle, alimentée par `ctx.transitionsByIssue` au lieu d'un SELECT. Pour `bySprint`, utiliser `ctx.store.issueSprints.byIssue(key)` ou un parcours de `ctx.store.issueSprints` via `bySprint`.

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/reworkCost.ts tests/metrics/reworkCost.test.ts
git commit -m "refactor(metrics): migrate rework-cost to MetricsContext (ticket 050)"
```

### Task 4.23: Migrer `scopeChange`

**Files:** `src/metrics/scopeChange.ts`, `tests/metrics/scopeChange.test.ts`

**Particularité :** détecte les changements significatifs de `description` ou `summary` après entrée en sprint. Source = `ctx.store.issueFieldChanges.byIssueAndField(key, "description"|"summary")` + `ctx.store.issueSprints.bySprint(...)`. Seuil de similarité 0.85.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — pour chaque sprint :
  - Lister les issues : `ctx.store.issueSprints.bySprint(sprintId).map((r) => r.issueKey)`
  - Pour chaque issue, lire les changements `description` et `summary` après l'entrée en sprint
  - Calculer la similarité (réutiliser la fonction existante)
  - Si < seuil → marqué `changed`
  - Output : `totalIssues`, `changedIssues`, `changeRatio`, `bySprint[]`, `changedIssueKeys`

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/scopeChange.ts tests/metrics/scopeChange.test.ts
git commit -m "refactor(metrics): migrate scope-change-rate to MetricsContext (ticket 050)"
```

### Task 4.24: Migrer `bottleneckAnalysis`

**Files:** `src/metrics/bottleneckAnalysis.ts`, `tests/metrics/bottleneckAnalysis.test.ts`

**Particularité :** score composite 0-1 par rôle (4 signaux : stageTime, avgNetFlow, reworkInbound, ftrPenalty). `byColumn[]` regroupe par colonne board.yaml (poolage de statuts), trié dev→qa→po puis médiane décroissante. Cette métrique consomme déjà les outputs d'autres métriques — elle peut soit les recalculer (préférable pour découplage), soit recevoir le `MetricsContext` qui dispose de toute la donnée brute.

- [ ] **Step 1-2 : Test adapté + FAIL**

- [ ] **Step 3 : `compute`** — reproduire le calcul actuel à partir de `ctx.cycleTimePopulation` et `ctx.transitions`. Pour `byColumn`, utiliser `ctx.config.boardColumns` (ajouter ce champ à `MetricConfig` si pas déjà présent — sinon passer par `ctx.store` comme fallback).

- [ ] **Step 4-5 : Run PASS + commit**

```bash
git add src/metrics/bottleneckAnalysis.ts tests/metrics/bottleneckAnalysis.test.ts
git commit -m "refactor(metrics): migrate bottleneck-analysis to MetricsContext (ticket 050)"
```

### Task 4.25: Mettre à jour le registre `runAllMetrics` / `runMetric`

**Files:**
- Modify: `src/metrics/index.ts`

- [ ] **Step 1 : Réécrire `runAllMetrics` et `runMetric` pour prendre `ctx` au lieu de `(db, config)`**

```typescript
// src/metrics/index.ts (extrait final, garder les imports existants)
import type { MetricsContext } from "./context";

export function runAllMetrics(ctx: MetricsContext): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const metric of ALL_METRICS) {
    results[metric.name] = metric.compute(ctx);
  }
  return results;
}

export function runMetric(name: string, ctx: MetricsContext): unknown {
  const metric = ALL_METRICS.find((m) => m.name === name);
  if (!metric) {
    throw new Error(`Métrique inconnue: ${name}. Disponibles: ${ALL_METRICS.map((m) => m.name).join(", ")}`);
  }
  return metric.compute(ctx);
}

export { ALL_METRICS };
```

- [ ] **Step 2 : Run la suite complète des métriques + le snapshot Phase 0**

Run: `npx vitest run tests/metrics tests/snapshots/metrics-output.test.ts`
Expected: tout vert. Si le snapshot diverge → bug introduit dans une migration ; revenir au commit fautif.

- [ ] **Step 3 : Commit**

```bash
git add src/metrics/index.ts
git commit -m "refactor(metrics): runAllMetrics/runMetric take MetricsContext (ticket 050)"
```

---

## Phase 5 — Snapshots / Report / Sync

### Task 5.1: Migrer `snapshots/compute.ts`

**Files:**
- Modify: `src/snapshots/compute.ts`
- Modify: `tests/snapshots/compute.test.ts` + `tests/snapshots/compute049.test.ts`

- [ ] **Step 1 : Adapter les tests pour passer un `Store` au lieu de `db`**

Dans chaque test : remplacer `backfillSnapshots(db, baseConfig)` par `backfillSnapshots(new SqliteStore(db), baseConfig)`. Le helper `createTestContext` n'est PAS utilisé ici — on passe le store directement, pas le contexte (il est rebuilé en interne par `backfillSnapshots`, par snapshot date).

- [ ] **Step 2 : Run → FAIL (signature ancienne)**

- [ ] **Step 3 : Réécrire `backfillSnapshots`**

```typescript
// src/snapshots/compute.ts (signature)
import type { Store } from "../store/types";
import type { MetricConfig } from "../metrics/types";
import type { SnapshotRecord } from "../store/types";
import { buildMetricsContext } from "../metrics/context";
import { runAllMetrics } from "../metrics";

export function backfillSnapshots(store: Store, baseConfig: MetricConfig): number {
  const allSnapshots: SnapshotRecord[] = [];
  // ... reproduire la logique actuelle de découpage des dates ...
  for (const snapshotDate of snapshotDates) {
    const windowConfig: MetricConfig = {
      ...baseConfig,
      windowEndDate: snapshotDate,
      cutoffDate: /* selon métrique : window 30j ou cumulative */,
    };
    const ctx = buildMetricsContext(store, windowConfig);
    const results = runAllMetrics(ctx);
    // ... extractStats(results) en SnapshotRecord[] ... (logique existante préservée)
    allSnapshots.push(...extracted);
  }
  store.snapshots.replaceAll(allSnapshots);
  return allSnapshots.length;
}
```

**Important :** la fenêtre par métrique (30j duration / 7j debit / cumulative) est dans la logique existante de `compute.ts` — la conserver intacte.

Aussi : `appConfig.set("snapshot_window_days", String(...))` remplace l'ancien `persistSnapshotWindowDays`.

- [ ] **Step 4 : Run all snapshot tests + baseline → PASS**

Run: `npx vitest run tests/snapshots`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/snapshots/compute.ts tests/snapshots/compute.test.ts tests/snapshots/compute049.test.ts
git commit -m "refactor(snapshots): backfillSnapshots takes Store, no SQL (ticket 050)"
```

### Task 5.2: Migrer `report/generate.ts`

**Files:**
- Modify: `src/report/generate.ts`
- Modify: `tests/report/generate.test.ts` (si présent)

- [ ] **Step 1 : Adapter signature et tests**

```typescript
// src/report/generate.ts (signature)
import type { ReadStore } from "../store/types";

export function generateReport(store: ReadStore, /* ...autres params... */): string {
  const snapshots = store.snapshots.all();
  // helpers : store.issues.byKey(key), store.sprints.byId(id)
  // toute requête SQL résiduelle → équivalent store.*
  // ...
}
```

Adapter tous les call sites de `generateReport(db, ...)` à `generateReport(store, ...)`. Pour le calcul live de `forecast` (ticket-spec dit : forecast calculé live dans report), construire un `MetricsContext` :

```typescript
const ctx = buildMetricsContext(store, metricConfig);
const forecast = forecastMetric.compute(ctx);
```

- [ ] **Step 2 : Run → FAIL puis fix**

- [ ] **Step 3 : Implémenter — supprimer tout `db.prepare`/`db.exec` du fichier**

- [ ] **Step 4 : Run report tests → PASS**

Run: `npx vitest run tests/report`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/report/generate.ts tests/report
git commit -m "refactor(report): generateReport takes ReadStore, no SQL (ticket 050)"
```

### Task 5.3: Migrer `sync.ts`

**Files:**
- Modify: `src/sync.ts`
- Modify: `tests/sync.test.ts` (si présent)

- [ ] **Step 1 : Adapter signature**

```typescript
// src/sync.ts (signature)
import type { Store } from "./store/types";

export async function sync(store: Store, jiraConfig: JiraFileConfig, boardConfig: BoardFileConfig): Promise<void> {
  // ... logique existante ...
  // Remplacer :
  //   getLastSyncDate(db, projectKey)        → store.syncLog.lastByProject(projectKey)?.syncedAt ?? null
  //   upsertIssues(db, ...)                  → store.issues.upsertMany(...)
  //   replaceAllTransitions(db, ...)         → store.transitions.replaceForIssues(...)
  //   upsertSprints(db, ...)                 → store.sprints.upsertMany(...)
  //   upsertStatuses(db, ...)                → store.statuses.upsertMany(...)
  //   replaceAllFieldChanges(db, ...)        → store.issueFieldChanges.replaceForIssues(...)
  //   replaceAllIssueSprints(db, ...)        → store.issueSprints.replaceForIssues(...)
  //   getStoredEstimationMethod(db)          → store.appConfig.get("estimation_method") ?? "time"
  //   persistEstimationMethod(db, m)         → store.appConfig.set("estimation_method", m)
  //   getStoredSnapshotWindowDays(db)        → store.appConfig.get("snapshot_window_days") parsé
  //   persistSnapshotWindowDays(db, n)       → store.appConfig.set("snapshot_window_days", String(n))
  //   logSync(db, projectKey, count)         → store.syncLog.append({ syncedAt: now().toISOString(), issuesCount: count, projectKey })
  //   db.transaction(...)                    → store.transaction(...)
  //   getDistinctTransitionStatuses(db, since?) → new Set(store.transitions.all().filter(...).map(...))
  //   getDoneStatusNames(db) / getAllStatuses(db) → store.statuses.all()
}
```

- [ ] **Step 2-4 : Adapter tests + run**

Run: `npx vitest run tests/sync`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/sync.ts tests/sync.test.ts
git commit -m "refactor(sync): sync() takes Store, no SQL (ticket 050)"
```

---

## Phase 6 — Bootstrap + nettoyage

### Task 6.1: `main.ts` injecte un seul SqliteStore

**Files:**
- Modify: `src/main.ts`
- Modify: `CLAUDE.md` (section Architecture + Adding a metric)

- [ ] **Step 1 : Refactor du bootstrap**

Dans `src/main.ts`, ajouter (en haut) :

```typescript
import { SqliteStore, openDb } from "./store/sqlite";
import type { Store, ReadStore } from "./store/types";
import { buildMetricsContext } from "./metrics/context";

function openStore(config: AppConfig): Store {
  return new SqliteStore(openDb(config.db.path));
}
```

Pour chaque commande qui touche à la DB (`sync`, `metrics`, `snapshots`, `report`, `refresh`, `autoconfig`) :

```typescript
const store = openStore(config);
// puis selon commande :
//   sync:        await sync(store, jiraConfig, boardConfig);
//   metrics:     const ctx = buildMetricsContext(store, metricConfig); const out = runAllMetrics(ctx);
//   snapshots:   backfillSnapshots(store, metricConfig);
//   report:      generateReport(store, ...);
//   refresh:     enchaîne sync → snapshots → report avec le même store
//   autoconfig:  utilise store.statuses.all() / store.issues.all() pour calibrateThresholds
```

`buildMetricConfig` (actuel `main.ts:203`) : remplacer son paramètre `db: Database.Database` par `store: ReadStore`. Remplacer chaque appel SQL interne (`getDoneStatusNames(db)`, `getAllStatuses(db)`) par `store.statuses.all()`.

`calibrateThresholds` (actuel `main.ts:331`) : remplacer accès `db` par `store.issues.all()`, garder le calcul TS local.

Commandes `validate-config` et `list-metrics` : **n'appellent pas `openStore`** (pas de DB).

- [ ] **Step 2 : Build + run E2E manuel**

```bash
npm run build
```
Expected: build PASS.

```bash
npm run metrics -- -b board.fake.yaml --json | head -c 500
```
Expected: JSON valide, mêmes clés que d'habitude.

```bash
npm run snapshots -- -b board.fake.yaml
```
Expected: ne plante pas.

```bash
npm run report -- -b board.fake.yaml -o /tmp/report.fake.html
```
Expected: HTML généré.

- [ ] **Step 3 : Mettre à jour `CLAUDE.md`**

Section Architecture : remplacer le paragraphe `Layers (src/)` pour lister `src/store/` et indiquer que les métriques consomment `MetricsContext`. Ajouter une note avant la section *Database schema* : "Le schéma ci-dessous est un détail d'implémentation de `SqliteStore` ; les métriques ne le voient pas — elles consomment `MetricsContext`."

Section *Adding a metric* : remplacer la signature exemple `Metric.compute(db, config)` par `Metric.compute(ctx: MetricsContext)`. Supprimer l'étape "use buildDeliveredCte()" — remplacer par "use ctx.cycleTimePopulation + ctx.deliveredAt".

- [ ] **Step 4 : Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/main.ts CLAUDE.md
git commit -m "feat(main): bootstrap a single SqliteStore per command (ticket 050)"
```

### Task 6.2: Suppression `src/db/store.ts` + test d'architecture

**Files:**
- Delete: `src/db/store.ts`
- Move: `src/db/schema.sql` → `src/store/sqlite/schema.sql` (ajuster le path dans `src/store/sqlite/schema.ts`)
- Create: `tests/architecture/no-sql-in-business-logic.test.ts`

- [ ] **Step 1 : Vérifier qu'aucun import ne référence `src/db/store.ts`**

Run: `grep -rn "from \".*db/store\"" src tests`
Expected: vide. Sinon, fixer chaque import vers `src/store/sqlite` ou `src/store/types`.

- [ ] **Step 2 : Déplacer le schema**

```bash
mv src/db/schema.sql src/store/sqlite/schema.sql
```

Adapter `src/store/sqlite/schema.ts` :

```typescript
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
```

- [ ] **Step 3 : Supprimer `src/db/store.ts`**

```bash
rm src/db/store.ts
rmdir src/db
```

- [ ] **Step 4 : Écrire le test d'architecture**

```typescript
// tests/architecture/no-sql-in-business-logic.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOTS = [
  "src/metrics",
  "src/snapshots",
  "src/report",
];
const FILES = ["src/sync.ts", "src/main.ts"];

const FORBIDDEN = [
  /\bdb\.prepare\b/,
  /\bdb\.exec\b/,
  /\bdb\.transaction\b/,
  /from ["']better-sqlite3["']/,
  /\bSELECT\s/i,
  /\bINSERT\s+INTO\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
];

function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) { out.push(...walk(full)); }
    else if (full.endsWith(".ts")) { out.push(full); }
  }
  return out;
}

describe("no SQL in business logic (CF-02)", () => {
  const files = [...ROOTS.flatMap(walk), ...FILES];
  for (const file of files) {
    it(`${file} contains no SQL or db.* calls`, () => {
      const content = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN) {
        const match = content.match(pattern);
        expect(match, `${file}: matched ${pattern} → "${match?.[0]}"`).toBeNull();
      }
    });
  }
});
```

- [ ] **Step 5 : Run all tests**

Run: `npx vitest run`
Expected: tout vert, y compris le test d'architecture et le snapshot baseline (Phase 0).

- [ ] **Step 6 : Commit**

```bash
git add -A
git commit -m "chore(store): remove src/db/store.ts, add architecture test (ticket 050)"
```

### Task 6.3: Mise à jour du statut ticket

**Files:**
- Modify: `docs/specs/tickets/050-store-abstraction/description.md`
- Modify: `docs/specs/tickets/050-store-abstraction/spec-fonctionnelle.md`
- Modify: `docs/specs/tickets/INDEX.md`

- [ ] **Step 1 : Passer `Statut: à faire` → `livré` dans les 3 fichiers**

- [ ] **Step 2 : Commit**

```bash
git add docs/specs/tickets/050-store-abstraction docs/specs/tickets/INDEX.md
git commit -m "docs(tickets): mark 050 store abstraction as delivered"
```

---

## Self-review du plan

**Couverture spec :**

| Critère fonctionnel | Tâche(s) |
|---|---|
| CF-01 — JSON métrics octet-à-octet | Phase 0 (baseline) + Task 4.25 (suite complète repassée) + Task 6.2 (final all-tests) |
| CF-02 — Logique métier sans SQL | Tasks 4.1–4.24 (migration) + Task 6.2 (test grep) |
| CF-03 — SqliteStore unique implémentation | Tasks 2.1–2.11 (un seul backend livré) ; tests `tests/store/contract*` couvrent le contrat |
| CF-04 — Façades séparées ReadStore/WriteStore | Task 1.1 (interfaces séparées) + Task 5.2 (report reçoit ReadStore) |
| CF-05 — Performance préservée (≤110%) | Validation manuelle après Task 6.1 — ajouter une mesure timing si besoin (non bloquant pour merge mais à faire avant) |
| CF-06 — Bootstrap unique | Task 6.1 |
| CF-07 — Documentation à jour | Task 6.1 (CLAUDE.md) |

**Note sur CF-05 :** ce plan ne contient pas de step explicite "mesurer perf avant/après". Si la perf KECK explose (>110%), c'est un blocker. Faire un benchmark manuel après Task 6.1 :

```bash
time npm run metrics -- -b board.yaml > /dev/null   # avant le merge, sur KECK réelle
```

Comparer aux 5 derniers runs sur master pré-refactor.

**Risques résiduels :**

- Tâche 4.14 (`agingWip`) — interaction avec `clock.now()` : vérifier que `frozenNow` est bien respecté en mode fake (sinon le snapshot baseline diverge entre runs).
- Tâche 4.24 (`bottleneckAnalysis`) — `byColumn` accède aux `boardColumns` ; si non présent dans `MetricConfig`, soit ajouter le champ, soit passer par `ctx.store`. Décider à l'implémentation, pas en avance.
- Phase 4 : si une métrique diverge (snapshot baseline FAIL), commit petit + bisect facile grâce à 1 commit / métrique.

---

## Référence rapide — primitives `MetricsContext`

| Besoin métrique | À utiliser dans `compute(ctx)` |
|---|---|
| Toutes les issues filtrées | `ctx.issues` |
| Une issue par clé | `ctx.issueByKey.get(key)` |
| Toutes les transitions filtrées | `ctx.transitions` |
| Transitions d'une issue (chronologiques) | `ctx.transitionsByIssue.get(key)` |
| Transitions vers un statut donné | `ctx.transitionsByToStatus.get(status)` |
| Date de livraison team-done par issue | `ctx.deliveredAt.get(key)` |
| Population cycle-time pré-filtrée | `ctx.cycleTimePopulation` |
| Jours ouvrés entre 2 dates | `ctx.workingDaysBetween(a, b)` |
| Semaine ISO d'une date | `ctx.isoWeek(date)` |
| Config courante | `ctx.config` |
| Accès direct au store (rare) | `ctx.store.issueSprints.bySprint(id)` etc. |

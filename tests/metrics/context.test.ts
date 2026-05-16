import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/sqlite/schema";
import { SqliteStore } from "../../src/store/sqlite";
import { buildMetricsContext, buildBaseMetricsContext, deriveMetricsContext } from "../../src/metrics/context";
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

describe("buildBaseMetricsContext + deriveMetricsContext", () => {
  it("deriveMetricsContext produit la même sortie que buildMetricsContext", () => {
    const direct = buildMetricsContext(store, baseConfig);
    const base = buildBaseMetricsContext(store, baseConfig);
    const derived = deriveMetricsContext(base, baseConfig);

    expect(derived.issues).toEqual(direct.issues);
    expect(derived.transitions).toEqual(direct.transitions);
    expect(Array.from(derived.issueByKey.keys())).toEqual(Array.from(direct.issueByKey.keys()));
    expect(Array.from(derived.transitionsByIssue.keys())).toEqual(Array.from(direct.transitionsByIssue.keys()));
    expect(Array.from(derived.transitionsByToStatus.keys())).toEqual(Array.from(direct.transitionsByToStatus.keys()));
    expect(Array.from(derived.deliveredAt.entries())).toEqual(Array.from(direct.deliveredAt.entries()));
    expect(derived.cycleTimePopulation).toEqual(direct.cycleTimePopulation);
    expect(derived.config).toEqual(direct.config);
  });

  it("deriveMetricsContext partage les Maps stables avec le baseContext (identity)", () => {
    const base = buildBaseMetricsContext(store, baseConfig);
    const d1 = deriveMetricsContext(base, baseConfig);
    const d2 = deriveMetricsContext(base, { ...baseConfig, cutoffDate: "2026-01-10" });

    expect(d1.issueByKey).toBe(d2.issueByKey);
    expect(d1.transitionsByIssue).toBe(d2.transitionsByIssue);
    expect(d1.transitionsByToStatus).toBe(d2.transitionsByToStatus);
    expect(d1.deliveredAt).toBe(d2.deliveredAt);
    expect(d1.issues).toBe(d2.issues);
    expect(d1.transitions).toBe(d2.transitions);
  });

  it("deriveMetricsContext ne relit pas le store (zéro appel à issues.all / transitions.all)", () => {
    const base = buildBaseMetricsContext(store, baseConfig);

    let issueCalls = 0;
    let transCalls = 0;
    const spyStore: typeof base.store = {
      ...base.store,
      issues: { ...base.store.issues, all: () => { issueCalls++; return base.store.issues.all(); } },
      transitions: { ...base.store.transitions, all: () => { transCalls++; return base.store.transitions.all(); } },
    };
    const baseWithSpy = { ...base, store: spyStore };

    deriveMetricsContext(baseWithSpy, baseConfig);
    deriveMetricsContext(baseWithSpy, { ...baseConfig, cutoffDate: "2026-01-10" });
    deriveMetricsContext(baseWithSpy, { ...baseConfig, windowEndDate: "2026-01-04T00:00:00Z" });

    expect(issueCalls).toBe(0);
    expect(transCalls).toBe(0);
  });

  it("deriveMetricsContext refiltre cycleTimePopulation selon cutoffDate", () => {
    const base = buildBaseMetricsContext(store, baseConfig);
    const tight = deriveMetricsContext(base, { ...baseConfig, cutoffDate: "2026-01-10" });
    expect(tight.cycleTimePopulation).toEqual([]);

    const loose = deriveMetricsContext(base, { ...baseConfig, cutoffDate: "2026-01-01" });
    expect(loose.cycleTimePopulation.map((s) => s.issueKey)).toEqual(["ABC-1"]);
  });

  it("deriveMetricsContext refiltre cycleTimePopulation selon windowEndDate", () => {
    const base = buildBaseMetricsContext(store, baseConfig);
    const early = deriveMetricsContext(base, { ...baseConfig, windowEndDate: "2026-01-04T00:00:00Z" });
    expect(early.cycleTimePopulation).toEqual([]);

    const late = deriveMetricsContext(base, { ...baseConfig, windowEndDate: "2026-01-06T00:00:00Z" });
    expect(late.cycleTimePopulation.map((s) => s.issueKey)).toEqual(["ABC-1"]);
  });

  it("deriveMetricsContext expose le config fourni à la dérivation (pas celui du base)", () => {
    const base = buildBaseMetricsContext(store, baseConfig);
    const override: MetricConfig = { ...baseConfig, cutoffDate: "2026-01-10" };
    const derived = deriveMetricsContext(base, override);
    expect(derived.config).toBe(override);
  });
});

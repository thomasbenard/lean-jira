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

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SprintsSqlite } from "../../../src/store/sqlite/sprints";
import { IssuesSqlite } from "../../../src/store/sqlite/issues";
import { IssueSprintsSqlite } from "../../../src/store/sqlite/issueSprints";

let db: Database.Database;

// pourquoi : la table issue_sprints a des FK vers issues(key) ET sprints(id) et openDb active
// foreign_keys=ON ; on sème les deux parents pour permettre les insertions de jointure.
beforeEach(() => {
  db = openDb(":memory:");
  new IssuesSqlite(db).upsertMany([{
    key: "ABC-1",
    summary: "X",
    issueType: "Story",
    createdAt: "2026-01-01T00:00:00Z",
    resolvedAt: null,
    currentStatus: "To Do",
    assignee: null,
    priority: null,
    currentSprintId: null,
    originalEstimateSeconds: null,
    storyPoints: null,
    sizeLabel: null,
  }]);
  new SprintsSqlite(db).upsertMany([
    { id: 1, name: "S1", state: "closed", startDate: null, endDate: null, boardId: 1 },
    { id: 2, name: "S2", state: "active", startDate: null, endDate: null, boardId: 1 },
  ]);
});

describe("IssueSprintsSqlite", () => {
  it("replaceForIssues insère puis byIssue retourne les sprintIds", () => {
    const store = new IssueSprintsSqlite(db);
    store.replaceForIssues([{ key: "ABC-1", sprintIds: [1, 2] }]);
    expect(store.byIssue("ABC-1").map((r) => r.sprintId).sort()).toEqual([1, 2]);
  });

  it("bySprint retourne les issues appartenant au sprint", () => {
    const store = new IssueSprintsSqlite(db);
    store.replaceForIssues([{ key: "ABC-1", sprintIds: [1] }]);
    expect(store.bySprint(1).map((r) => r.issueKey)).toEqual(["ABC-1"]);
    expect(store.bySprint(2)).toEqual([]);
  });
});

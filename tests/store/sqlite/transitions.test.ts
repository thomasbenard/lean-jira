import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { IssuesSqlite } from "../../../src/store/sqlite/issues";
import { TransitionsSqlite } from "../../../src/store/sqlite/transitions";
import type { IssueRecord } from "../../../src/store/types";

let db: Database.Database;
let transitions: TransitionsSqlite;

// pourquoi : la table transitions a une FK vers issues(key) et openDb active foreign_keys=ON ;
// on sème les issues parentes pour permettre les insertions de transitions.
function seedIssue(key: string): IssueRecord {
  return {
    key,
    summary: "seed",
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
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  const issues = new IssuesSqlite(db);
  issues.upsertMany([seedIssue("ABC-1"), seedIssue("ABC-2")]);
  transitions = new TransitionsSqlite(db);
});

describe("TransitionsSqlite", () => {
  it("replaceForIssue insère les lignes puis byIssue les retourne ordonnées", () => {
    transitions.replaceForIssue("ABC-1", [
      { issueKey: "ABC-1", fromStatus: null, toStatus: "To Do", transitionedAt: "2026-01-01T00:00:00Z" },
      { issueKey: "ABC-1", fromStatus: "To Do", toStatus: "In Progress", transitionedAt: "2026-01-02T00:00:00Z" },
    ]);
    const rows = transitions.byIssue("ABC-1");
    expect(rows.map((r) => r.toStatus)).toEqual(["To Do", "In Progress"]);
    expect(rows[0].id).toBeGreaterThan(0);
  });

  it("replaceForIssue remplace les lignes précédentes", () => {
    transitions.replaceForIssue("ABC-1", [
      { issueKey: "ABC-1", fromStatus: null, toStatus: "Old", transitionedAt: "2026-01-01T00:00:00Z" },
    ]);
    transitions.replaceForIssue("ABC-1", [
      { issueKey: "ABC-1", fromStatus: null, toStatus: "New", transitionedAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(transitions.byIssue("ABC-1").map((r) => r.toStatus)).toEqual(["New"]);
  });

  it("replaceForIssues traite plusieurs issues en lot atomiquement", () => {
    transitions.replaceForIssues([
      { key: "ABC-1", rows: [{ issueKey: "ABC-1", fromStatus: null, toStatus: "A", transitionedAt: "2026-01-01T00:00:00Z" }] },
      { key: "ABC-2", rows: [{ issueKey: "ABC-2", fromStatus: null, toStatus: "B", transitionedAt: "2026-01-01T00:00:00Z" }] },
    ]);
    expect(transitions.all()).toHaveLength(2);
  });

  it("all retourne les lignes ordonnées par id", () => {
    transitions.replaceForIssues([
      { key: "ABC-1", rows: [{ issueKey: "ABC-1", fromStatus: null, toStatus: "A", transitionedAt: "2026-01-01T00:00:00Z" }] },
      { key: "ABC-2", rows: [{ issueKey: "ABC-2", fromStatus: null, toStatus: "B", transitionedAt: "2026-01-01T00:00:00Z" }] },
    ]);
    const all = transitions.all();
    expect(all[0].id).toBeLessThan(all[1].id);
  });
});

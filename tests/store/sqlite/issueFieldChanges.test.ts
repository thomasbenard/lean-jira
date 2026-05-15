import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { IssuesSqlite } from "../../../src/store/sqlite/issues";
import { IssueFieldChangesSqlite } from "../../../src/store/sqlite/issueFieldChanges";
import type { IssueRecord } from "../../../src/store/types";

let db: Database.Database;
let changes: IssueFieldChangesSqlite;

// pourquoi : la table issue_field_changes a une FK vers issues(key) et openDb active foreign_keys=ON ;
// on sème les issues parentes pour permettre les insertions de changements de champs.
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
  issues.upsertMany([seedIssue("ABC-1")]);
  changes = new IssueFieldChangesSqlite(db);
});

describe("IssueFieldChangesSqlite", () => {
  it("replaceForIssues insère puis byIssueAndField retourne les lignes filtrées par champ", () => {
    changes.replaceForIssues([{
      key: "ABC-1",
      rows: [
        { issueKey: "ABC-1", fieldName: "description", fromValue: "old", toValue: "new", changedAt: "2026-01-02T00:00:00Z" },
        { issueKey: "ABC-1", fieldName: "summary", fromValue: "x", toValue: "y", changedAt: "2026-01-01T00:00:00Z" },
      ],
    }]);
    const desc = changes.byIssueAndField("ABC-1", "description");
    expect(desc).toHaveLength(1);
    expect(desc[0].toValue).toBe("new");
  });

  it("replaceForIssues remplace les lignes existantes pour la même issue", () => {
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

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
  key: "ABC-1",
  summary: "Test",
  issueType: "Story",
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
  currentStatus: "To Do",
  assignee: null,
  priority: null,
  currentSprintId: null,
  originalEstimateSeconds: 28800,
  storyPoints: null,
  sizeLabel: null,
};

describe("IssuesSqlite", () => {
  it("upsertMany puis all renvoie la ligne", () => {
    issues.upsertMany([sample]);
    expect(issues.all()).toEqual([sample]);
  });

  it("byKey renvoie null si la clé n'existe pas", () => {
    expect(issues.byKey("NOPE-1")).toBeNull();
  });

  it("byKey renvoie la ligne correspondante", () => {
    issues.upsertMany([sample]);
    expect(issues.byKey("ABC-1")).toEqual(sample);
  });

  it("upsertMany met à jour une ligne existante", () => {
    issues.upsertMany([sample]);
    issues.upsertMany([{ ...sample, summary: "Updated" }]);
    expect(issues.byKey("ABC-1")?.summary).toBe("Updated");
  });

  describe("byKeys", () => {
    it("renvoie [] sans frapper la DB pour un tableau vide", () => {
      issues.upsertMany([sample]);
      expect(issues.byKeys([])).toEqual([]);
    });

    it("renvoie les lignes correspondant aux clés fournies", () => {
      const a = { ...sample, key: "ABC-1" };
      const b = { ...sample, key: "ABC-2", summary: "Second" };
      const c = { ...sample, key: "ABC-3", summary: "Third" };
      issues.upsertMany([a, b, c]);
      const result = issues.byKeys(["ABC-1", "ABC-3"]);
      const byKey = new Map(result.map((r) => [r.key, r]));
      expect(byKey.size).toBe(2);
      expect(byKey.get("ABC-1")).toEqual(a);
      expect(byKey.get("ABC-3")).toEqual(c);
    });

    it("ignore silencieusement les clés absentes (pas de null dans le résultat)", () => {
      issues.upsertMany([sample]);
      const result = issues.byKeys(["ABC-1", "NOPE-1", "NOPE-2"]);
      expect(result).toEqual([sample]);
    });

    it("renvoie [] si aucune clé fournie ne matche", () => {
      issues.upsertMany([sample]);
      expect(issues.byKeys(["NOPE-1", "NOPE-2"])).toEqual([]);
    });
  });
});

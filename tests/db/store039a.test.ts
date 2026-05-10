import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { upsertIssues, getStoredEstimationMethod, persistEstimationMethod } from "../../src/db/store";
import type Database from "better-sqlite3";
import { makeIssue, resetSeq } from "../helpers/seeders";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

describe("upsertIssues — colonnes estimation", () => {
  it("stocke story_points si fourni", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", storyPoints: 8 })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBe(8);
  });

  it("stocke size_label si fourni", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", sizeLabel: "M" })]);
    const row = db.prepare("SELECT size_label FROM issues WHERE key = 'PROJ-1'").get() as { size_label: string | null };
    expect(row.size_label).toBe("M");
  });

  it("stocke NULL pour story_points absent", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", storyPoints: null })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBeNull();
  });

  it("stocke NULL pour size_label absent", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", sizeLabel: null })]);
    const row = db.prepare("SELECT size_label FROM issues WHERE key = 'PROJ-1'").get() as { size_label: string | null };
    expect(row.size_label).toBeNull();
  });

  it("met à jour story_points sur conflit de clé", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", storyPoints: 3 })]);
    upsertIssues(db, [makeIssue({ key: "PROJ-1", storyPoints: 13 })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBe(13);
  });

  it("écrase story_points avec NULL sur conflit de clé si nouvelle valeur est null", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", storyPoints: 8 })]);
    upsertIssues(db, [makeIssue({ key: "PROJ-1", storyPoints: null })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBeNull();
  });
});

describe("getStoredEstimationMethod / persistEstimationMethod", () => {
  it("retourne time si aucune méthode stockée", () => {
    expect(getStoredEstimationMethod(db)).toBe("time");
  });

  it("retourne la méthode après persistEstimationMethod", () => {
    persistEstimationMethod(db, "story-points");
    expect(getStoredEstimationMethod(db)).toBe("story-points");
  });

  it("écrase la méthode précédente", () => {
    persistEstimationMethod(db, "story-points");
    persistEstimationMethod(db, "t-shirt");
    expect(getStoredEstimationMethod(db)).toBe("t-shirt");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { SqliteStore } from "../../src/store/sqlite";
import type Database from "better-sqlite3";
import { makeIssue, resetSeq } from "../helpers/seeders";

let db: Database.Database;
let store: SqliteStore;
beforeEach(() => {
  db = createTestDb();
  store = new SqliteStore(db);
  resetSeq();
});

describe("issues.upsertMany — colonnes estimation", () => {
  it("stocke story_points si fourni", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", storyPoints: 8 })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBe(8);
  });

  it("stocke size_label si fourni", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", sizeLabel: "M" })]);
    const row = db.prepare("SELECT size_label FROM issues WHERE key = 'PROJ-1'").get() as { size_label: string | null };
    expect(row.size_label).toBe("M");
  });

  it("stocke NULL pour story_points absent", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", storyPoints: null })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBeNull();
  });

  it("stocke NULL pour size_label absent", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", sizeLabel: null })]);
    const row = db.prepare("SELECT size_label FROM issues WHERE key = 'PROJ-1'").get() as { size_label: string | null };
    expect(row.size_label).toBeNull();
  });

  it("met à jour story_points sur conflit de clé", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", storyPoints: 3 })]);
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", storyPoints: 13 })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBe(13);
  });

  it("écrase story_points avec NULL sur conflit de clé si nouvelle valeur est null", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", storyPoints: 8 })]);
    store.issues.upsertMany([makeIssue({ key: "PROJ-1", storyPoints: null })]);
    const row = db.prepare("SELECT story_points FROM issues WHERE key = 'PROJ-1'").get() as { story_points: number | null };
    expect(row.story_points).toBeNull();
  });
});

describe("appConfig — estimation_method", () => {
  it("retourne null si aucune méthode stockée", () => {
    expect(store.appConfig.get("estimation_method")).toBeNull();
  });

  it("retourne la méthode après set", () => {
    store.appConfig.set("estimation_method", "story-points");
    expect(store.appConfig.get("estimation_method")).toBe("story-points");
  });

  it("écrase la méthode précédente", () => {
    store.appConfig.set("estimation_method", "story-points");
    store.appConfig.set("estimation_method", "t-shirt");
    expect(store.appConfig.get("estimation_method")).toBe("t-shirt");
  });
});

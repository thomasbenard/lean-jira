import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SprintsSqlite } from "../../../src/store/sqlite/sprints";
import type { SprintRecord } from "../../../src/store/types";

let db: Database.Database;
let sprints: SprintsSqlite;

const sample: SprintRecord = {
  id: 42,
  name: "Sprint 1",
  state: "active",
  startDate: "2026-01-01T00:00:00Z",
  endDate: "2026-01-15T00:00:00Z",
  boardId: 7,
};

beforeEach(() => {
  db = openDb(":memory:");
  sprints = new SprintsSqlite(db);
});

describe("SprintsSqlite", () => {
  it("upsertMany puis all retourne la ligne", () => {
    sprints.upsertMany([sample]);
    expect(sprints.all()).toEqual([sample]);
  });

  it("byId retourne le sprint correspondant", () => {
    sprints.upsertMany([sample]);
    expect(sprints.byId(42)).toEqual(sample);
  });

  it("byId retourne null quand absent", () => {
    expect(sprints.byId(999)).toBeNull();
  });
});

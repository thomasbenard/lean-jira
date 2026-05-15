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
  it("upsertMany puis all retourne les lignes ordonnées par nom", () => {
    statuses.upsertMany([
      { name: "Done", categoryKey: "done", categoryName: "Done" },
      { name: "To Do", categoryKey: "new", categoryName: "To Do" },
    ]);
    expect(statuses.all().map((s) => s.name)).toEqual(["Done", "To Do"]);
  });

  it("upsertMany met à jour la catégorie sur conflit", () => {
    statuses.upsertMany([{ name: "X", categoryKey: "new", categoryName: "X" }]);
    statuses.upsertMany([{ name: "X", categoryKey: "done", categoryName: "X-renamed" }]);
    expect(statuses.all()[0].categoryKey).toBe("done");
  });
});

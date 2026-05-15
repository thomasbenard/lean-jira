import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { AppConfigSqlite } from "../../../src/store/sqlite/appConfig";

let db: Database.Database;
let cfg: AppConfigSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  cfg = new AppConfigSqlite(db);
});

describe("AppConfigSqlite", () => {
  it("get retourne null si la clé est absente", () => {
    expect(cfg.get("k")).toBeNull();
  });

  it("set puis get retourne la valeur stockée", () => {
    cfg.set("estimation_method", "story-points");
    expect(cfg.get("estimation_method")).toBe("story-points");
  });

  it("set écrase la valeur existante d'une clé", () => {
    cfg.set("k", "v1");
    cfg.set("k", "v2");
    expect(cfg.get("k")).toBe("v2");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SyncLogSqlite } from "../../../src/store/sqlite/syncLog";

let db: Database.Database;
let log: SyncLogSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  log = new SyncLogSqlite(db);
});

describe("SyncLogSqlite", () => {
  it("lastByProject retourne null si aucun sync pour le projet", () => {
    expect(log.lastByProject("KECK")).toBeNull();
  });

  it("append puis lastByProject retourne l'entrée la plus récente du projet", () => {
    log.append({ syncedAt: "2026-01-01T00:00:00Z", issuesCount: 10, projectKey: "KECK" });
    log.append({ syncedAt: "2026-01-02T00:00:00Z", issuesCount: 12, projectKey: "KECK" });
    log.append({ syncedAt: "2026-01-02T00:00:00Z", issuesCount: 5, projectKey: "OTHER" });
    expect(log.lastByProject("KECK")?.syncedAt).toBe("2026-01-02T00:00:00Z");
    expect(log.lastByProject("KECK")?.issuesCount).toBe(12);
    expect(log.lastByProject("OTHER")?.issuesCount).toBe(5);
  });
});

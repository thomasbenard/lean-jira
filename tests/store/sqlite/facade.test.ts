import { describe, it, expect } from "vitest";
import { openDb } from "../../../src/store/sqlite/schema";
import { SqliteStore } from "../../../src/store/sqlite";
import type { Store } from "../../../src/store/types";

describe("SqliteStore", () => {
  it("implémente l'interface Store et expose tous les sous-domaines", () => {
    const db = openDb(":memory:");
    const store: Store = new SqliteStore(db);
    expect(store.issues.all()).toEqual([]);
    expect(store.transitions.all()).toEqual([]);
    expect(store.sprints.all()).toEqual([]);
    expect(store.statuses.all()).toEqual([]);
    expect(store.snapshots.all()).toEqual([]);
    expect(store.appConfig.get("k")).toBeNull();
    expect(store.syncLog.lastByProject("X")).toBeNull();
  });

  it("transaction retourne la valeur du callback et rollback en cas d'exception", () => {
    const db = openDb(":memory:");
    const store = new SqliteStore(db);
    expect(store.transaction(() => 42)).toBe(42);
    expect(() =>
      store.transaction(() => {
        store.statuses.upsertMany([
          { name: "X", categoryKey: "new", categoryName: "X" },
        ]);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.statuses.all()).toEqual([]);
  });
});

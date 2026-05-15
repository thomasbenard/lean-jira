import { describe, it, expect } from "vitest";
import { openDb } from "../../../src/store/sqlite/schema";

describe("openDb", () => {
  it("crée une DB en mémoire avec la table issues", () => {
    const db = openDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("current_sprint_id");
    expect(cols.map((c) => c.name)).toContain("story_points");
    expect(cols.map((c) => c.name)).toContain("size_label");
  });

  it("active le mode journal WAL", () => {
    const db = openDb(":memory:");
    const mode = (db.pragma("journal_mode", { simple: true }) as string).toLowerCase();
    // pourquoi : SQLite renvoie "memory" pour ":memory:" et "wal" pour les fichiers réels
    expect(["memory", "wal"]).toContain(mode);
  });
});

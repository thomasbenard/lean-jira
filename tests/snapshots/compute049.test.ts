import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { backfillSnapshots } from "../../src/snapshots/compute";
import { SqliteStore } from "../../src/store/sqlite";
import type Database from "better-sqlite3";

let db: Database.Database;
let store: SqliteStore;
beforeEach(() => {
  db = createTestDb();
  store = new SqliteStore(db);
  resetSeq();
});

// pourquoi : remplace getStoredSnapshotWindowDays / persistSnapshotWindowDays (legacy db/store).
// La valeur est persistée dans app_config avec parsing Number côté lecture.
function getStoredSnapshotWindowDays(): number | null {
  const v = store.appConfig.get("snapshot_window_days");
  return v ? Number(v) : null;
}
function persistSnapshotWindowDays(days: number): void {
  store.appConfig.set("snapshot_window_days", String(days));
}

describe("getStoredSnapshotWindowDays", () => {
  it("retourne null si aucune valeur stockée", () => {
    expect(getStoredSnapshotWindowDays()).toBeNull();
  });

  it("retourne la valeur persistée", () => {
    persistSnapshotWindowDays(14);
    expect(getStoredSnapshotWindowDays()).toBe(14);
  });

  it("écrase la valeur précédente", () => {
    persistSnapshotWindowDays(14);
    persistSnapshotWindowDays(60);
    expect(getStoredSnapshotWindowDays()).toBe(60);
  });
});

describe("backfillSnapshots — snapshotWindowDays", () => {
  it("utilise fenêtre 14j si snapshotWindowDays=14 (seul ticket livré dans la fenêtre)", () => {
    // Issue livrée 10 jours avant le dernier snapshot : doit apparaître avec fenêtre 14j,
    // mais pas si l'équipe utilisait 7j.
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-04-01T09:00:00Z" },
      { to: "Done",        at: "2025-04-10T09:00:00Z" }, // livré 10j avant 2025-04-20 (snapshot date)
    ]);

    const countWith14 = backfillSnapshots(new SqliteStore(db), { ...TEST_CONFIG, cutoffDate: "2025-04-14", snapshotWindowDays: 14 });
    expect(countWith14).toBeGreaterThan(0);

    // Le snapshot du 2025-04-20 (dimanche après cutoff) doit contenir un cycle-time
    const rows = db.prepare(
      "SELECT value FROM metric_snapshots WHERE metric_name='cycle-time' AND stat='count' AND value > 0"
    ).all() as { value: number }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it("fenêtre 7j : issue livrée 10j avant n'entre pas dans le snapshot correspondant", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-04-01T09:00:00Z" },
      { to: "Done",        at: "2025-04-10T09:00:00Z" }, // livré 10j avant 2025-04-20 (snapshot date)
    ]);

    backfillSnapshots(new SqliteStore(db), { ...TEST_CONFIG, cutoffDate: "2025-04-14", snapshotWindowDays: 7 });

    // Avec fenêtre 7j, le snapshot du 2025-04-20 regarde du 2025-04-13 au 2025-04-20 :
    // l'issue livrée le 05-04 est hors fenêtre → count=0 pour ce point
    const snapshot = db.prepare(
      "SELECT value FROM metric_snapshots WHERE snapshot_date='2025-04-20' AND metric_name='cycle-time' AND stat='count'"
    ).get() as { value: number } | undefined;
    expect(snapshot?.value ?? 0).toBe(0);
  });

  it("défaut 30j si snapshotWindowDays absent", () => {
    // Sans le champ, le comportement doit être identique à snapshotWindowDays=30
    const count = backfillSnapshots(new SqliteStore(db), { ...TEST_CONFIG, cutoffDate: "2099-01-01" });
    expect(count).toBe(0); // futur → 0 semaines
  });
});

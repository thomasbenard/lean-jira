import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../../src/store/sqlite/schema";
import { SnapshotsSqlite } from "../../../src/store/sqlite/snapshots";
import type { SnapshotRecord } from "../../../src/store/types";

let db: Database.Database;
let snaps: SnapshotsSqlite;

beforeEach(() => {
  db = openDb(":memory:");
  snaps = new SnapshotsSqlite(db);
});

const r1: SnapshotRecord = {
  snapshotDate: "2026-01-01",
  metricName: "lead-time",
  bucket: "ALL",
  stat: "medianDays",
  value: 4.2,
};
const r2: SnapshotRecord = {
  snapshotDate: "2026-01-08",
  metricName: "lead-time",
  bucket: "ALL",
  stat: "medianDays",
  value: 5.0,
};

describe("SnapshotsSqlite", () => {
  it("replaceAll puis all retourne les lignes", () => {
    snaps.replaceAll([r1, r2]);
    expect(snaps.all()).toHaveLength(2);
  });

  it("replaceAll efface les lignes précédentes", () => {
    snaps.replaceAll([r1]);
    snaps.replaceAll([r2]);
    expect(snaps.all()).toEqual([r2]);
  });

  it("byDate filtre par date de snapshot", () => {
    snaps.replaceAll([r1, r2]);
    expect(snaps.byDate("2026-01-01")).toEqual([r1]);
  });
});

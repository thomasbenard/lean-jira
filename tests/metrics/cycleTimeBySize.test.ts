import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { cycleTimeBySizeMetric } from "../../src/metrics/cycleTimeBySize";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

function seedWithEstimate(key: string, estimateSeconds: number | null, issueType = "Story") {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, issueType, originalEstimateSeconds: estimateSeconds }),
    [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]
  );
}

describe("cycleTimeBySizeMetric.compute", () => {
  it("retourne buckets vides sans données", () => {
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(Object.keys(result.buckets)).toHaveLength(0);
  });

  it("estimate null → bucket UNESTIMATED", () => {
    seedWithEstimate("PROJ-1", null);
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.UNESTIMATED).toBeDefined();
    expect(result.buckets.UNESTIMATED!.count).toBe(1);
  });

  it("Bug → bucket BUG quel que soit l'estimate", () => {
    seedWithEstimate("BUG-1", SECONDS_PER_DAY * 2, "Bug");
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.BUG).toBeDefined();
    expect(result.buckets.M).toBeUndefined();
  });

  it("estimate < 0.5j → XS", () => {
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 0.4);
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.XS).toBeDefined();
  });

  it("estimate 1j → M (1j ∈ [1j, 3j[)", () => {
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 1);
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.M).toBeDefined();
  });

  it("estimate 5j → XL", () => {
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 5);
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.XL).toBeDefined();
  });

  it("stats par bucket indépendantes", () => {
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 0.4); // XS
    seedWithEstimate("PROJ-2", SECONDS_PER_DAY * 5);   // XL
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.XS!.count).toBe(1);
    expect(result.buckets.XL!.count).toBe(1);
  });

  it("bucket absent des données n'apparaît pas dans le résultat", () => {
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 0.4); // XS seulement
    const result = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.XL).toBeUndefined();
    expect(result.buckets.S).toBeUndefined();
  });
});

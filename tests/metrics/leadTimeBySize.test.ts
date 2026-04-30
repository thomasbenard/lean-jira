import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { leadTimeBySizeMetric } from "../../src/metrics/leadTimeBySize";
import { cycleTimeBySizeMetric } from "../../src/metrics/cycleTimeBySize";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// To Do lun, In Progress mer, Done ven → lead=4j, cycle=2j
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

describe("leadTimeBySizeMetric.compute", () => {
  it("retourne buckets vides sans données", () => {
    const result = leadTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(Object.keys(result.buckets)).toHaveLength(0);
  });

  it("Bug → bucket BUG", () => {
    seedWithEstimate("BUG-1", SECONDS_PER_DAY * 2, "Bug");
    const result = leadTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.BUG).toBeDefined();
  });

  it("estimate null → UNESTIMATED", () => {
    seedWithEstimate("PROJ-1", null);
    const result = leadTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.UNESTIMATED).toBeDefined();
  });

  it("lead-time-by-size >= cycle-time-by-size pour même bucket", () => {
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 2); // M bucket, lead=4j cycle=2j
    const lt = leadTimeBySizeMetric.compute(db, TEST_CONFIG);
    const ct = cycleTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(lt.buckets.M!.medianDays).toBeGreaterThanOrEqual(ct.buckets.M!.medianDays);
  });

  it("mesure depuis todoAt (pas devStartAt)", () => {
    // lead = 4j (lun→ven), cycle = 2j (mer→ven)
    seedWithEstimate("PROJ-1", SECONDS_PER_DAY * 2);
    const result = leadTimeBySizeMetric.compute(db, TEST_CONFIG);
    expect(result.buckets.M!.medianDays).toBe(4);
  });
});

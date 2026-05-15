import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { leadTimeNormalizedMetric } from "../../src/metrics/leadTimeNormalized";
import { cycleTimeNormalizedMetric } from "../../src/metrics/cycleTimeNormalized";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// To Do lun, In Progress mer, Done ven → lead=4j, cycle=2j, estimate=2j
function seedNormalized(key: string, estimateSeconds: number, issueType = "Story") {
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

describe("leadTimeNormalizedMetric.compute", () => {
  it("retourne stats vides si aucune issue estimée", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", originalEstimateSeconds: null }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = leadTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(0);
  });

  it("exclut les Bugs", () => {
    seedNormalized("BUG-1", SECONDS_PER_DAY * 2, "Bug");
    const result = leadTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(0);
  });

  it("ratio = leadTimeDays / estimateDays", () => {
    seedNormalized("PROJ-1", SECONDS_PER_DAY * 2); // lead=4j, estimate=2j → ratio=2.0
    const result = leadTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.medianDays).toBeCloseTo(2.0, 5);
  });

  it("lead-normalized >= cycle-normalized pour même issue (lead > cycle)", () => {
    seedNormalized("PROJ-1", SECONDS_PER_DAY * 2);
    const ltn = leadTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG)).medianDays;
    // pourquoi : cycleTimeNormalized sera migré en Task 4.6 ; appel old-style en attendant (même précédent que Task 4.1)
    const ctn = cycleTimeNormalizedMetric.compute(db as never, TEST_CONFIG as never).medianDays;
    expect(ltn).toBeGreaterThanOrEqual(ctn);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { cycleTimeNormalizedMetric } from "../../src/metrics/cycleTimeNormalized";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// In Progress mer→ven = 2j de cycle, estimate = 2j → ratio=1.0
function seedNormalizedIssue(key: string, estimateSeconds: number, issueType = "Story") {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, issueType, originalEstimateSeconds: estimateSeconds }),
    [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" }, // cycle = 2j
    ]
  );
}

describe("cycleTimeNormalizedMetric.compute", () => {
  it("retourne stats vides si aucune issue avec estimate > 0", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", originalEstimateSeconds: null }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(0);
  });

  it("exclut les issues avec estimate null", () => {
    seedNormalizedIssue("PROJ-1", SECONDS_PER_DAY * 2);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2", originalEstimateSeconds: null }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(1);
  });

  it("exclut les Bugs", () => {
    seedNormalizedIssue("BUG-1", SECONDS_PER_DAY * 2, "Bug");
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(0);
  });

  it("ratio = 1.0 quand cycle = estimate (2j cycle / 2j estimé)", () => {
    seedNormalizedIssue("PROJ-1", SECONDS_PER_DAY * 2); // cycle 2j, estimate 2j
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(1);
    expect(result.medianDays).toBeCloseTo(1.0, 5);
  });

  it("ratio < 1 quand cycle < estimate (plus rapide que prévu)", () => {
    seedNormalizedIssue("PROJ-1", SECONDS_PER_DAY * 4); // cycle 2j, estimate 4j → 0.5
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.medianDays).toBeCloseTo(0.5, 5);
  });

  it("ratio > 1 quand cycle > estimate (plus lent que prévu)", () => {
    seedNormalizedIssue("PROJ-1", SECONDS_PER_DAY * 1); // cycle 2j, estimate 1j → 2.0
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.medianDays).toBeCloseTo(2.0, 5);
  });

  it("unit est une chaîne de description", () => {
    const result = cycleTimeNormalizedMetric.compute(createTestContext(db, { ...TEST_CONFIG, bugIssueTypes: [] }));
    expect(typeof result.unit).toBe("string");
    expect(result.unit.length).toBeGreaterThan(0);
  });
});

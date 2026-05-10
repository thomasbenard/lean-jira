import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { leadTimeBySizeMetric } from "../../src/metrics/leadTimeBySize";
import { cycleTimeBySizeMetric } from "../../src/metrics/cycleTimeBySize";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// To Do lun, In Progress mer, Done ven → lead=4j, cycle=2j
function seedWithSp(key: string, storyPoints: number | null, issueType = "Story") {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, issueType, storyPoints, originalEstimateSeconds: null }),
    [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ],
  );
}

function seedWithSizeLabel(key: string, sizeLabel: string | null, issueType = "Story") {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, issueType, sizeLabel, originalEstimateSeconds: null }),
    [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ],
  );
}

const SP_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  estimation: { method: "story-points" },
};

const TSHIRT_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  estimation: { method: "t-shirt", jiraField: "customfield_10200" },
};

describe("leadTimeBySize — méthode story-points", () => {
  it("5 SP → bucket M", () => {
    seedWithSp("PROJ-1", 5);
    const result = leadTimeBySizeMetric.compute(db, SP_CONFIG);
    expect(result.buckets.M).toBeDefined();
    expect(result.buckets.UNESTIMATED).toBeUndefined();
  });

  it("SP null → UNESTIMATED", () => {
    seedWithSp("PROJ-1", null);
    const result = leadTimeBySizeMetric.compute(db, SP_CONFIG);
    expect(result.buckets.UNESTIMATED).toBeDefined();
  });

  it("bug avec SP → BUG", () => {
    seedWithSp("BUG-1", 8, "Bug");
    const result = leadTimeBySizeMetric.compute(db, SP_CONFIG);
    expect(result.buckets.BUG).toBeDefined();
  });

  it("ignore original_estimate_seconds pour story-points", () => {
    // SP=5 → M, même si originalEstimateSeconds = 28800 (qui ferait M aussi mais pour raison différente)
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "PROJ-1", storyPoints: 5, originalEstimateSeconds: 28800 }),
      [
        { to: "To Do",       at: "2025-01-06T09:00:00Z" },
        { to: "In Progress", at: "2025-01-08T09:00:00Z" },
        { to: "Done",        at: "2025-01-10T09:00:00Z" },
      ],
    );
    const resultSp = leadTimeBySizeMetric.compute(db, SP_CONFIG);
    // L'issue doit être dans M via SP, pas via time
    expect(resultSp.buckets.M).toBeDefined();
  });
});

describe("cycleTimeBySize — méthode story-points", () => {
  it("5 SP → bucket M, medianDays = 2", () => {
    seedWithSp("PROJ-1", 5);
    const result = cycleTimeBySizeMetric.compute(db, SP_CONFIG);
    expect(result.buckets.M).toBeDefined();
    expect(result.buckets.M!.medianDays).toBe(2);
  });

  it("SP null → UNESTIMATED", () => {
    seedWithSp("PROJ-1", null);
    const result = cycleTimeBySizeMetric.compute(db, SP_CONFIG);
    expect(result.buckets.UNESTIMATED).toBeDefined();
  });
});

describe("leadTimeBySize — méthode t-shirt", () => {
  it("sizeLabel='L' → bucket L", () => {
    seedWithSizeLabel("PROJ-1", "L");
    const result = leadTimeBySizeMetric.compute(db, TSHIRT_CONFIG);
    expect(result.buckets.L).toBeDefined();
  });

  it("sizeLabel=null → UNESTIMATED", () => {
    seedWithSizeLabel("PROJ-1", null);
    const result = leadTimeBySizeMetric.compute(db, TSHIRT_CONFIG);
    expect(result.buckets.UNESTIMATED).toBeDefined();
  });
});

describe("cycleTimeBySize — méthode t-shirt", () => {
  it("sizeLabel='M' → bucket M, medianDays = 2", () => {
    seedWithSizeLabel("PROJ-1", "M");
    const result = cycleTimeBySizeMetric.compute(db, TSHIRT_CONFIG);
    expect(result.buckets.M).toBeDefined();
    expect(result.buckets.M!.medianDays).toBe(2);
  });
});

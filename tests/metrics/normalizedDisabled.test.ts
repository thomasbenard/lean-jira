import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { leadTimeNormalizedMetric } from "../../src/metrics/leadTimeNormalized";
import { cycleTimeNormalizedMetric } from "../../src/metrics/cycleTimeNormalized";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

const SP_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  estimation: { method: "story-points" },
};

const TSHIRT_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  estimation: { method: "t-shirt", jiraField: "customfield_10200" },
};

const NONE_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  estimation: { method: "none" },
};

const TIME_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  estimation: { method: "time" },
};

function seedEstimated(key: string) {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, originalEstimateSeconds: SECONDS_PER_DAY * 2 }),
    [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ],
  );
}

describe("leadTimeNormalized — disabled hors méthode time", () => {
  it("story-points → disabled: true, count: 0", () => {
    seedEstimated("PROJ-1");
    const result = leadTimeNormalizedMetric.compute(db, SP_CONFIG) as { disabled?: boolean; count: number };
    expect(result.disabled).toBe(true);
    expect(result.count).toBe(0);
  });

  it("t-shirt → disabled: true", () => {
    seedEstimated("PROJ-1");
    const result = leadTimeNormalizedMetric.compute(db, TSHIRT_CONFIG) as { disabled?: boolean };
    expect(result.disabled).toBe(true);
  });

  it("none → disabled: true", () => {
    const result = leadTimeNormalizedMetric.compute(db, NONE_CONFIG) as { disabled?: boolean };
    expect(result.disabled).toBe(true);
  });

  it("time → calcul normal, pas de disabled", () => {
    seedEstimated("PROJ-1");
    const result = leadTimeNormalizedMetric.compute(db, TIME_CONFIG) as { disabled?: boolean; count: number };
    expect(result.disabled).toBeUndefined();
    expect(result.count).toBeGreaterThan(0);
  });
});

describe("cycleTimeNormalized — disabled hors méthode time", () => {
  it("story-points → disabled: true, count: 0", () => {
    seedEstimated("PROJ-1");
    const result = cycleTimeNormalizedMetric.compute(db, SP_CONFIG) as { disabled?: boolean; count: number };
    expect(result.disabled).toBe(true);
    expect(result.count).toBe(0);
  });

  it("t-shirt → disabled: true", () => {
    seedEstimated("PROJ-1");
    const result = cycleTimeNormalizedMetric.compute(db, TSHIRT_CONFIG) as { disabled?: boolean };
    expect(result.disabled).toBe(true);
  });

  it("time → calcul normal, pas de disabled", () => {
    seedEstimated("PROJ-1");
    const result = cycleTimeNormalizedMetric.compute(db, TIME_CONFIG) as { disabled?: boolean; count: number };
    expect(result.disabled).toBeUndefined();
    expect(result.count).toBeGreaterThan(0);
  });
});

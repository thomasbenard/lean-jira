import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { throughputWeightedMetric } from "../../src/metrics/throughputWeighted";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

function cfg(method: string, extra: object = {}) {
  return { ...TEST_CONFIG, estimation: { method, ...extra } as typeof TEST_CONFIG.estimation };
}

function seedSP(key: string, doneAt: string, storyPoints: number | null) {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, storyPoints }),
    [{ to: "Done", at: doneAt }],
  );
}

describe("throughputWeighted — méthode time", () => {
  it("retourne unit='j-h' et disabled=false", () => {
    const result = throughputWeightedMetric.compute(db, cfg("time"));
    expect(result.unit).toBe("j-h");
    expect(result.disabled).toBe(false);
  });
});

describe("throughputWeighted — méthode story-points", () => {
  it("unit='SP' et somme story_points", () => {
    seedSP("PROJ-1", "2025-01-06T09:00:00Z", 5);
    seedSP("PROJ-2", "2025-01-07T09:00:00Z", 3);
    const result = throughputWeightedMetric.compute(db, cfg("story-points"));
    expect(result.unit).toBe("SP");
    expect(result.disabled).toBe(false);
    expect(result.byWeek[0].estimatedDays).toBeCloseTo(8, 5);
  });

  it("story_points null → unestimatedCount", () => {
    seedSP("PROJ-1", "2025-01-06T09:00:00Z", 5);
    seedSP("PROJ-2", "2025-01-07T09:00:00Z", null);
    const result = throughputWeightedMetric.compute(db, cfg("story-points"));
    expect(result.byWeek[0].estimatedCount).toBe(1);
    expect(result.byWeek[0].unestimatedCount).toBe(1);
  });
});

describe("throughputWeighted — méthode numeric", () => {
  it("unit='pts' et somme story_points", () => {
    seedSP("PROJ-1", "2025-01-06T09:00:00Z", 10);
    const result = throughputWeightedMetric.compute(db, cfg("numeric", { jiraField: "customfield_10099", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } }));
    expect(result.unit).toBe("pts");
    expect(result.disabled).toBe(false);
    expect(result.byWeek[0].estimatedDays).toBeCloseTo(10, 5);
  });
});

describe("throughputWeighted — méthode t-shirt", () => {
  it("retourne disabled=true", () => {
    const result = throughputWeightedMetric.compute(db, cfg("t-shirt", { jiraField: "customfield_10200" }));
    expect(result.disabled).toBe(true);
    expect(result.byWeek).toHaveLength(0);
  });
});

describe("throughputWeighted — méthode none", () => {
  it("retourne disabled=true", () => {
    const result = throughputWeightedMetric.compute(db, cfg("none"));
    expect(result.disabled).toBe(true);
    expect(result.byWeek).toHaveLength(0);
  });
});

describe("throughputWeighted — avgPerWeek en SP sur 2 semaines", () => {
  it("average correcte multi-semaines", () => {
    seedSP("PROJ-1", "2025-01-06T09:00:00Z", 8);   // W01: 8 SP
    seedSP("PROJ-2", "2025-01-13T09:00:00Z", 4);   // W02: 4 SP
    const result = throughputWeightedMetric.compute(db, cfg("story-points"));
    expect(result.avgPerWeek).toBeCloseTo(6, 5);    // (8+4)/2
  });
});

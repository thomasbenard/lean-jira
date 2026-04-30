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

function seedDelivered(key: string, doneAt: string, estimateSeconds: number | null, issueType = "Story") {
  seedIssueWithTransitions(
    db,
    makeIssue({ key, issueType, originalEstimateSeconds: estimateSeconds }),
    [{ to: "Done", at: doneAt }]
  );
}

describe("throughputWeightedMetric.compute", () => {
  it("retourne byWeek vide sans données", () => {
    const result = throughputWeightedMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(0);
    expect(result.avgPerWeek).toBe(0);
  });

  it("estimatedDays = sum(estimate_seconds) / 28800 pour la semaine", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z", SECONDS_PER_DAY * 2); // 2j
    seedDelivered("PROJ-2", "2025-01-07T09:00:00Z", SECONDS_PER_DAY * 1); // 1j
    const result = throughputWeightedMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek[0].estimatedDays).toBeCloseTo(3, 5);
  });

  it("estimatedCount = nb issues avec estimate > 0", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z", SECONDS_PER_DAY * 2);
    seedDelivered("PROJ-2", "2025-01-07T09:00:00Z", null); // non estimée
    const result = throughputWeightedMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek[0].estimatedCount).toBe(1);
    expect(result.byWeek[0].unestimatedCount).toBe(1);
  });

  it("unestimatedCount inclut null et 0", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z", null);
    seedDelivered("PROJ-2", "2025-01-07T09:00:00Z", 0);
    const result = throughputWeightedMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek[0].unestimatedCount).toBe(2);
  });

  it("exclut les Bugs", () => {
    seedDelivered("BUG-1", "2025-01-06T09:00:00Z", SECONDS_PER_DAY * 2, "Bug");
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z", SECONDS_PER_DAY * 1, "Story");
    const result = throughputWeightedMetric.compute(db, TEST_CONFIG);
    // seule la Story est comptée → 1j
    expect(result.byWeek[0].estimatedDays).toBeCloseTo(1, 5);
    expect(result.byWeek[0].estimatedCount).toBe(1);
  });

  it("avgPerWeek = somme estimatedDays / nb semaines", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z", SECONDS_PER_DAY * 2); // W01: 2j
    seedDelivered("PROJ-2", "2025-01-13T09:00:00Z", SECONDS_PER_DAY * 4); // W02: 4j
    const result = throughputWeightedMetric.compute(db, TEST_CONFIG);
    expect(result.avgPerWeek).toBeCloseTo(3, 5); // (2+4)/2 = 3
  });
});

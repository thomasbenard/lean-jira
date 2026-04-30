import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { bugCycleTimeMetric } from "../../src/metrics/bugCycleTime";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

function seedBug(key: string, startAt: string, doneAt: string) {
  seedIssueWithTransitions(db, makeIssue({ key, issueType: "Bug" }), [
    { to: "In Progress", at: startAt },
    { to: "Done",        at: doneAt },
  ]);
}

function seedStory(key: string, startAt: string, doneAt: string) {
  seedIssueWithTransitions(db, makeIssue({ key, issueType: "Story" }), [
    { to: "In Progress", at: startAt },
    { to: "Done",        at: doneAt },
  ]);
}

describe("bugCycleTimeMetric.compute", () => {
  it("retourne stats vides si bugIssueTypes est vide", () => {
    seedBug("BUG-1", "2025-01-06T09:00:00Z", "2025-01-08T09:00:00Z");
    const result = bugCycleTimeMetric.compute(db, { ...TEST_CONFIG, bugIssueTypes: [] });
    expect(result.count).toBe(0);
  });

  it("retourne stats vides si aucun bug livré", () => {
    const result = bugCycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("calcule cycle-time pour les Bugs uniquement", () => {
    seedBug("BUG-1", "2025-01-06T09:00:00Z", "2025-01-08T09:00:00Z"); // 2j
    seedStory("STORY-1", "2025-01-06T09:00:00Z", "2025-01-10T09:00:00Z"); // doit être exclu
    const result = bugCycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(1);
  });

  it("exclut les Stories du calcul", () => {
    seedStory("STORY-1", "2025-01-06T09:00:00Z", "2025-01-10T09:00:00Z");
    const result = bugCycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("unit = 'j'", () => {
    const result = bugCycleTimeMetric.compute(db, { ...TEST_CONFIG, bugIssueTypes: [] });
    expect(result.unit).toBe("j");
  });

  it("cutoffDate respecté", () => {
    seedBug("BUG-1", "2025-01-06T09:00:00Z", "2025-01-08T09:00:00Z"); // done jan 8
    const result = bugCycleTimeMetric.compute(db, { ...TEST_CONFIG, cutoffDate: "2025-01-09" });
    expect(result.count).toBe(0);
  });

  it("windowEndDate respecté", () => {
    seedBug("BUG-1", "2025-01-06T09:00:00Z", "2025-01-10T09:00:00Z"); // done jan 10
    const result = bugCycleTimeMetric.compute(db, { ...TEST_CONFIG, windowEndDate: "2025-01-09" });
    expect(result.count).toBe(0);
  });
});

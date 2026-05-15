import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { bugThroughputMetric } from "../../src/metrics/bugThroughput";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

describe("bugThroughputMetric.compute", () => {
  it("retourne byWeek vide si bugIssueTypes est vide", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "BUG-1", issueType: "Bug" }), [
      { to: "Done", at: "2025-01-06T09:00:00Z" },
    ]);
    const result = bugThroughputMetric.compute(createTestContext(db, { ...TEST_CONFIG, bugIssueTypes: [] }));
    expect(result.byWeek).toHaveLength(0);
    expect(result.avgPerWeek).toBe(0);
  });

  it("retourne byWeek vide si aucun bug livré", () => {
    const result = bugThroughputMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.byWeek).toHaveLength(0);
  });

  it("compte les bugs par semaine", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "BUG-1", issueType: "Bug" }), [
      { to: "Done", at: "2025-01-06T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "BUG-2", issueType: "Bug" }), [
      { to: "Done", at: "2025-01-07T09:00:00Z" },
    ]);
    const result = bugThroughputMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].count).toBe(2);
  });

  it("exclut les Stories du décompte", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "STORY-1", issueType: "Story" }), [
      { to: "Done", at: "2025-01-06T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "BUG-1", issueType: "Bug" }), [
      { to: "Done", at: "2025-01-06T09:00:00Z" },
    ]);
    const result = bugThroughputMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.byWeek[0].count).toBe(1);
  });

  it("2 semaines → avgPerWeek = total / 2", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "BUG-1", issueType: "Bug" }), [
      { to: "Done", at: "2025-01-06T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "BUG-2", issueType: "Bug" }), [
      { to: "Done", at: "2025-01-13T09:00:00Z" },
    ]);
    const result = bugThroughputMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.avgPerWeek).toBe(1);
  });
});

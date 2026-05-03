import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { leadTimeMetric } from "../../src/metrics/leadTime";
import { cycleTimeMetric } from "../../src/metrics/cycleTime";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Fixture canonique : To Do lundi, In Progress mercredi, Done vendredi
// lead = 4j (lun→ven), cycle = 2j (mer→ven)
function seedCanonical(key = "PROJ-1") {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" },
    { to: "Done",        at: "2025-01-10T09:00:00Z" },
  ]);
}

describe("leadTimeMetric.compute", () => {
  it("retourne stats vides quand aucune issue livrée", () => {
    const result = leadTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("durée correcte pour l'issue canonique (4 jours ouvrés lun→ven)", () => {
    seedCanonical();
    const result = leadTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(1);
    expect(result.issues[0].leadTimeDays).toBe(4);
    expect(result.avgDays).toBe(4);
  });

  it("lead-time >= cycle-time pour la même issue", () => {
    seedCanonical();
    const lt = leadTimeMetric.compute(db, TEST_CONFIG).issues[0].leadTimeDays;
    const ct = cycleTimeMetric.compute(db, TEST_CONFIG).issues[0].cycleTimeDays;
    expect(lt).toBeGreaterThanOrEqual(ct);
  });

  it("exclut une issue sans transition devStartStatus (pas dans la population cycle-time)", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do", at: "2025-01-06T09:00:00Z" },
      { to: "Done",  at: "2025-01-10T09:00:00Z" },
    ]);
    const result = leadTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("exclut une issue sans transition todoStatus", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = leadTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("todoAt = 1ère transition todoStatus (MIN)", () => {
    // Re-entre en To Do après un retour
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" }, // 1ère
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "To Do",       at: "2025-01-09T09:00:00Z" }, // retour
      { to: "In Progress", at: "2025-01-09T12:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = leadTimeMetric.compute(db, TEST_CONFIG);
    expect(result.issues[0].todoAt).toBe("2025-01-06T09:00:00Z");
  });

  it("cutoffDate exclut les issues livrées avant", () => {
    seedCanonical(); // done 2025-01-10
    const result = leadTimeMetric.compute(db, { ...TEST_CONFIG, cutoffDate: "2025-01-11" });
    expect(result.count).toBe(0);
  });

  it("windowEndDate exclut les issues livrées après", () => {
    seedCanonical(); // done 2025-01-10
    const result = leadTimeMetric.compute(db, { ...TEST_CONFIG, windowEndDate: "2025-01-09" });
    expect(result.count).toBe(0);
  });

  it("excludeIssueTypes exclut les issues Feature et Epic", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Feature" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2", issueType: "Story" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = leadTimeMetric.compute(db, { ...TEST_CONFIG, excludeIssueTypes: ["Feature", "Epic"] });
    expect(result.count).toBe(1);
    expect(result.issues[0].issueKey).toBe("PROJ-2");
  });
});

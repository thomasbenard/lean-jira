import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { flowEfficiencyMetric } from "../../src/metrics/flowEfficiency";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Fixture : To Do lun, In Progress mer (2j actifs), In Review ven (1j queue), Done lun suivant
// activeDays = 2, queueDays = 1, FE = 2/3
function seedFlowIssue(key = "PROJ-1") {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // mer
    { to: "In Review",   at: "2025-01-10T09:00:00Z" }, // ven
    { to: "Done",        at: "2025-01-13T09:00:00Z" }, // lun
  ]);
}

describe("flowEfficiencyMetric.compute", () => {
  it("retourne résultat vide si activeStatuses est vide", () => {
    seedFlowIssue();
    const cfg = { ...TEST_CONFIG, activeStatuses: [] };
    const result = flowEfficiencyMetric.compute(createTestContext(db, cfg));
    expect(result.count).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("retourne résultat vide si aucune issue dans la population cycle-time", () => {
    const result = flowEfficiencyMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(0);
  });

  it("calcule activeDays et queueDays correctement", () => {
    seedFlowIssue();
    const result = flowEfficiencyMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(1);
    const issue = result.issues[0];
    expect(issue.activeDays).toBe(2); // mer→ven = 2j
    expect(issue.queueDays).toBe(1);  // ven→lun = 1j (skip week-end)
  });

  it("flowEfficiency = activeDays / (activeDays + queueDays)", () => {
    seedFlowIssue();
    const result = flowEfficiencyMetric.compute(createTestContext(db, TEST_CONFIG));
    const fe = result.issues[0].flowEfficiency;
    expect(fe).toBeCloseTo(2 / 3, 5);
  });

  it("aggregateFlowEfficiency = sum(active) / (sum(active) + sum(queue)) pondéré", () => {
    seedFlowIssue();
    const result = flowEfficiencyMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.aggregateFlowEfficiency).toBeCloseTo(result.totalActiveDays / (result.totalActiveDays + result.totalQueueDays), 5);
  });

  it("statut hors activeStatuses et queueStatuses → ignoré (ni actif ni queue)", () => {
    // Ajoute un statut "Blocked" entre In Progress et In Review → non compté
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // 1j actif
      { to: "Blocked",     at: "2025-01-09T09:00:00Z" }, // ignoré
      { to: "In Progress", at: "2025-01-10T09:00:00Z" }, // 2j actif (ven→lun+mar... wait)
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const result = flowEfficiencyMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.count).toBe(1);
    // Blocked ne contribue ni à active ni à queue
    const issue = result.issues[0];
    expect(issue.queueDays).toBe(0);
    // activeDays = segment(In Progress Jan8→Jan9) + segment(In Progress Jan10→Done Jan13)
    // = workingDays(Jan8,Jan9) + workingDays(Jan10,Jan13) = 1 + 1 = 2
    expect(issue.activeDays).toBeGreaterThan(0);
  });

  it("issue avec seule phase active → FE = 100%", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = flowEfficiencyMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.issues[0].flowEfficiency).toBe(1);
  });

  it("cutoffDate respecté", () => {
    seedFlowIssue(); // done 2025-01-13
    const result = flowEfficiencyMetric.compute(createTestContext(db, { ...TEST_CONFIG, cutoffDate: "2025-01-14" }));
    expect(result.count).toBe(0);
  });

  it("windowEndDate respecté", () => {
    seedFlowIssue(); // done 2025-01-13
    const result = flowEfficiencyMetric.compute(createTestContext(db, { ...TEST_CONFIG, windowEndDate: "2025-01-12" }));
    expect(result.count).toBe(0);
  });
});

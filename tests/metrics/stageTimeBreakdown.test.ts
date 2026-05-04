import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { stageTimeBreakdownMetric } from "../../src/metrics/stageTimeBreakdown";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

const ROLE_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  devStatuses: ["In Progress"],
  qaStatuses: ["In Review"],
  poStatuses: [],
};

// Fixture canonique : To Do lundi, In Progress mercredi → In Review vendredi → Done mardi suivant
// devDays = 2 (mer→ven), qaDays = 2 (ven→mar), cycleDays = 4 (mer→mar)
function seedCanonical(key = "PROJ-1") {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" },
    { to: "In Review",   at: "2025-01-10T09:00:00Z" },
    { to: "Done",        at: "2025-01-14T09:00:00Z" },
  ]);
}

describe("stageTimeBreakdownMetric.compute", () => {
  it("retourne count 0 si aucune issue livrée", () => {
    const result = stageTimeBreakdownMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(0);
    expect(result.byRole.dev.count).toBe(0);
    expect(result.byRole.qa.count).toBe(0);
    expect(result.byRole.po.count).toBe(0);
  });

  it("retourne empty result si aucun rôle configuré dans board.yaml", () => {
    seedCanonical();
    const noRoleConfig: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: [],
      qaStatuses: [],
      poStatuses: [],
    };
    const result = stageTimeBreakdownMetric.compute(db, noRoleConfig);
    expect(result.count).toBe(0);
    expect(result.avgShareByRole).toEqual({ dev: 0, qa: 0, po: 0 });
    expect(result.byRole.dev.count).toBe(0);
  });

  it("calcule correctement devDays et qaDays pour ticket nominal", () => {
    seedCanonical();
    const result = stageTimeBreakdownMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(1);
    expect(result.byRole.dev.avgDays).toBe(2);
    expect(result.byRole.dev.medianDays).toBe(2);
    expect(result.byRole.qa.avgDays).toBe(2);
    expect(result.byRole.qa.medianDays).toBe(2);
    expect(result.byRole.po.avgDays).toBe(0);
    expect(result.byRole.po.count).toBe(1);
  });

  it("avgShareByRole correct pour ticket nominal (dev=0.5, qa=0.5)", () => {
    seedCanonical();
    const result = stageTimeBreakdownMetric.compute(db, ROLE_CONFIG);
    expect(result.avgShareByRole.dev).toBeCloseTo(0.5);
    expect(result.avgShareByRole.qa).toBeCloseTo(0.5);
    expect(result.avgShareByRole.po).toBe(0);
  });

  it("cumule les passages multiples dev→qa→dev (rework)", () => {
    // dev: mer→ven = 2j, qa: ven→lun = 1j, dev: lun→mar = 1j → devDays=3, qaDays=1
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "In Progress", at: "2025-01-13T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = stageTimeBreakdownMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(1);
    expect(result.byRole.dev.avgDays).toBe(3);
    expect(result.byRole.qa.avgDays).toBe(1);
  });

  it("exclut ticket sans transition todoStatus (hors population cycle-time)", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = stageTimeBreakdownMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(0);
  });

  it("exclut ticket où done_at < started_at (anomalie données)", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "Done",        at: "2025-01-08T09:00:00Z" }, // done avant devStart
      { to: "In Progress", at: "2025-01-10T09:00:00Z" }, // devStart après done
    ]);
    const result = stageTimeBreakdownMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(0);
  });

  it("cutoffDate exclut les tickets livrés avant la date", () => {
    seedCanonical(); // done 2025-01-14
    const cfg = { ...ROLE_CONFIG, cutoffDate: "2025-01-15" };
    const result = stageTimeBreakdownMetric.compute(db, cfg);
    expect(result.count).toBe(0);
  });

  it("filtre outliers sur cycleDays quand excludeOutliers activé (≥4 issues)", () => {
    // 4 issues : 3 normales (cycleDays ~4) + 1 outlier (cycleDays >> 100)
    const cfg = { ...ROLE_CONFIG, excludeOutliers: true };
    for (let i = 1; i <= 3; i++) {
      seedIssueWithTransitions(db, makeIssue({ key: `PROJ-${i}` }), [
        { to: "To Do",       at: "2025-01-06T09:00:00Z" },
        { to: "In Progress", at: "2025-01-08T09:00:00Z" },
        { to: "In Review",   at: "2025-01-10T09:00:00Z" },
        { to: "Done",        at: "2025-01-14T09:00:00Z" },
      ]);
    }
    // Outlier : cycle 300j
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-4" }), [
      { to: "To Do",       at: "2024-01-01T09:00:00Z" },
      { to: "In Progress", at: "2024-01-02T09:00:00Z" },
      { to: "Done",        at: "2024-12-01T09:00:00Z" },
    ]);
    const result = stageTimeBreakdownMetric.compute(db, cfg);
    expect(result.count).toBe(3);
    expect(result.excludedOutliers).toBe(1);
  });

  it("avgShareByRole exclut les tickets où sum role-days = 0", () => {
    // T1: passe par "Dev" (rôle) → devDays > 0 → inclus dans share
    // T2: reste en "In Progress" qui n'est pas dans devStatuses=["Dev"] → sum=0 → exclu
    const specialConfig: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["Dev"],
      qaStatuses: [],
      poStatuses: [],
    };
    // T1: dev jeu→lun = 2j dans "Dev"
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Dev",         at: "2025-01-09T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    // T2: reste en "In Progress" (pas dans devStatuses) → sum role-days = 0
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const result = stageTimeBreakdownMetric.compute(db, specialConfig);
    expect(result.count).toBe(2);
    // Seul T1 contribue au share (T2 sum=0 exclu) → dev share = 1.0
    expect(result.avgShareByRole.dev).toBeCloseTo(1);
    expect(result.avgShareByRole.qa).toBe(0);
  });
});

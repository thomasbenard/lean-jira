import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { firstTimeRightMetric } from "../../src/metrics/firstTimeRight";
import { createTestContext } from "../_helpers/createTestContext";
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
  poStatuses: ["Validation PO"],
};

// Fixture nominale : todo → dev → qa → done (1 passage dev, 1 passage qa)
function seedNominal(key = "PROJ-1") {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" },
    { to: "In Review",   at: "2025-01-10T09:00:00Z" },
    { to: "Done",        at: "2025-01-14T09:00:00Z" },
  ]);
}

describe("firstTimeRightMetric.compute", () => {
  it("retourne count 0 et ftrRate 0 si aucune issue livrée", () => {
    const result = firstTimeRightMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(0);
    expect(result.ftrByRole.dev.eligible).toBe(0);
    expect(result.ftrByRole.qa.eligible).toBe(0);
    expect(result.ftrByRole.po.eligible).toBe(0);
    // ftrRate = 0 quand eligible=0 (formule spec retourne 0 par convention)
    expect(result.ftrByRole.dev.ftrRate).toBe(0);
  });

  it("compte 1 passage dev et 1 passage qa pour ticket nominal", () => {
    seedNominal();
    const result = firstTimeRightMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.ftrByRole.dev.eligible).toBe(1);
    expect(result.ftrByRole.dev.firstTimeRight).toBe(1);
    expect(result.ftrByRole.dev.ftrRate).toBe(1);
    expect(result.ftrByRole.dev.avgPasses).toBe(1);

    expect(result.ftrByRole.qa.eligible).toBe(1);
    expect(result.ftrByRole.qa.firstTimeRight).toBe(1);
    expect(result.ftrByRole.qa.ftrRate).toBe(1);
    expect(result.ftrByRole.qa.avgPasses).toBe(1);

    // Aucun passage PO : exclu du dénominateur
    expect(result.ftrByRole.po.eligible).toBe(0);
  });

  it("détecte 2 passages dev quand ticket repasse en dev après qa", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // passage dev #1
      { to: "In Review",   at: "2025-01-10T09:00:00Z" }, // qa
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // passage dev #2 (rework)
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = firstTimeRightMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.ftrByRole.dev.eligible).toBe(1);
    expect(result.ftrByRole.dev.firstTimeRight).toBe(0); // 2 passages → pas FTR
    expect(result.ftrByRole.dev.ftrRate).toBe(0);
    expect(result.ftrByRole.dev.avgPasses).toBe(2);
    // 1 seul passage qa → FTR QA = 1
    expect(result.ftrByRole.qa.firstTimeRight).toBe(1);
    expect(result.ftrByRole.qa.ftrRate).toBe(1);
  });

  it("un statut none entre deux blocs du même rôle crée deux passages distincts", () => {
    // dev → To Do (none) → dev : doit compter 2 passages dev (coupure réelle)
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // passage dev #1
      { to: "To Do",       at: "2025-01-10T09:00:00Z" }, // none (reset)
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // passage dev #2
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = firstTimeRightMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.ftrByRole.dev.eligible).toBe(1);
    expect(result.ftrByRole.dev.firstTimeRight).toBe(0); // 2 passages
    expect(result.ftrByRole.dev.avgPasses).toBe(2);
  });

  it("ticket sans passage dans un rôle est exclu du dénominateur de ce rôle", () => {
    // Ticket uniquement dev, jamais qa ni po
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = firstTimeRightMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.ftrByRole.qa.eligible).toBe(0);
    expect(result.ftrByRole.po.eligible).toBe(0);
    // dev: 1 passage → FTR = 1
    expect(result.ftrByRole.dev.eligible).toBe(1);
    expect(result.ftrByRole.dev.ftrRate).toBe(1);
  });

  it("rôle PO non configuré → ftrByRole.po.eligible = 0", () => {
    const noPo: MetricConfig = { ...ROLE_CONFIG, poStatuses: [] };
    seedNominal();
    const result = firstTimeRightMetric.compute(createTestContext(db, noPo));
    expect(result.ftrByRole.po.eligible).toBe(0);
    expect(result.ftrByRole.po.ftrRate).toBe(0);
  });

  it("agrège correctement plusieurs tickets avec FTR mixtes", () => {
    // PROJ-1 : 1 passage dev → FTR dev
    seedNominal("PROJ-1");
    // PROJ-2 : 2 passages dev (rework) → pas FTR dev
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // rework
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = firstTimeRightMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(2);
    expect(result.ftrByRole.dev.eligible).toBe(2);
    expect(result.ftrByRole.dev.firstTimeRight).toBe(1); // seulement PROJ-1
    expect(result.ftrByRole.dev.ftrRate).toBeCloseTo(0.5);
    expect(result.ftrByRole.dev.avgPasses).toBeCloseTo(1.5); // (1+2)/2
  });

  it("respecte cutoffDate et exclut les issues livrées avant la borne", () => {
    // Issue livrée avant cutoffDate
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2024-12-01T09:00:00Z" },
      { to: "In Progress", at: "2024-12-03T09:00:00Z" },
      { to: "Done",        at: "2024-12-10T09:00:00Z" },
    ]);
    const cfg: MetricConfig = { ...ROLE_CONFIG, cutoffDate: "2025-01-01" };
    const result = firstTimeRightMetric.compute(createTestContext(db, cfg));
    expect(result.count).toBe(0);
  });
});

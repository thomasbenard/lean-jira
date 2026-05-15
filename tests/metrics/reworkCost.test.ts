import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, makeSprint, seedIssueWithTransitions, seedSprint, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { reworkCostMetric } from "../../src/metrics/reworkCost";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";
import { createTestContext } from "../_helpers/createTestContext";

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

describe("reworkCostMetric.compute", () => {
  // Règle 1 — Détection des passes rework

  it("retourne tous les agrégats à 0 si aucune issue livrée", () => {
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(0);
    expect(result.reworkedCount).toBe(0);
    expect(result.totalReworkDays).toBe(0);
    expect(result.reworkRatio).toBe(0);
    expect(result.avgReworkDaysPerReworkedTicket).toBe(0);
    expect(result.reworkCostRatio).toBe(0);
    expect(result.byWeek).toEqual([]);
    expect(result.bySprint).toEqual([]);
  });

  it("retourne 0 rework pour flux linéaire dev → qa → done", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-07T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkedCount).toBe(0);
    expect(result.totalReworkDays).toBe(0);
    expect(result.byWeek).toEqual([]);
  });

  it("comptabilise la 2e passe DEV via statut no-role comme rework", () => {
    // DEV1(3j) → Code Review no-role(1j) → DEV2 rework(2j) → Done
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-07T09:00:00Z" },
      { to: "Code Review",  at: "2025-01-10T09:00:00Z" }, // no-role
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" }, // rework
      { to: "Done",         at: "2025-01-15T09:00:00Z" }, // 2j (lun+mar)
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.reworkedCount).toBe(1);
    expect(result.totalReworkDays).toBeCloseTo(2);
    expect(result.reworkCostRatio).toBeGreaterThan(0);
  });

  it("comptabilise les reworks inter-rôle dev → qa → dev → qa", () => {
    // DEV1(3j) → QA1(1j) → DEV2 rework(2j) → QA2 rework(1j) → Done
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-07T09:00:00Z" }, // DEV1 start
      { to: "In Review",   at: "2025-01-10T09:00:00Z" }, // QA1 (3j DEV1)
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // DEV2 rework (1j QA1: ven)
      { to: "In Review",   at: "2025-01-15T09:00:00Z" }, // QA2 rework (2j DEV2: lun+mar)
      { to: "Done",        at: "2025-01-16T09:00:00Z" }, // Done (1j QA2: mer)
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.reworkedCount).toBe(1);
    expect(result.totalReworkDays).toBeCloseTo(3); // 2j DEV2 + 1j QA2
  });

  // Règle 2 — Exclusion todoStatuses

  it("exclut le temps en todoStatuses entre deux passes DEV", () => {
    // DEV1(3j) → Code Review(1j) → TODO(4j) → DEV2 rework(2j) → Done
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-07T09:00:00Z" },
      { to: "Code Review",  at: "2025-01-10T09:00:00Z" }, // no-role
      { to: "To Do",        at: "2025-01-13T09:00:00Z" }, // todoStatus
      { to: "In Progress",  at: "2025-01-20T09:00:00Z" }, // rework (lun)
      { to: "Done",         at: "2025-01-22T09:00:00Z" }, // Done (lun+mar = 2j)
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.reworkedCount).toBe(1);
    expect(result.totalReworkDays).toBeCloseTo(2); // seul le 2e DEV compte
  });

  it("passage par TODO seul sans retour au même rôle ne génère pas de rework", () => {
    // DEV(3j) → TODO(2j) → QA(1j) → Done : QA est 1ère passe → pas rework
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-07T09:00:00Z" },
      { to: "To Do",       at: "2025-01-10T09:00:00Z" }, // retour todo
      { to: "In Review",   at: "2025-01-14T09:00:00Z" }, // QA 1ère passe
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.reworkedCount).toBe(0);
    expect(result.totalReworkDays).toBe(0);
  });

  // Règle 3 — Distribution hebdomadaire

  it("distribue le coût rework proportionnellement sur 2 semaines", () => {
    // DEV2 rework 8j-ouvrés : lun 2025-01-13 (W03) → jeu 2025-01-23 (W04)
    // W03 reçoit 5j, W04 reçoit 3j
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-06T10:00:00Z" }, // devStart
      { to: "In Review",   at: "2025-01-06T11:00:00Z" }, // QA instant
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // rework start (lun W03)
      { to: "Done",        at: "2025-01-23T09:00:00Z" }, // 8j-ouvrés (jeu W04)
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    const w03 = result.byWeek.find((w) => w.week === "2025-W03");
    const w04 = result.byWeek.find((w) => w.week === "2025-W04");
    expect(w03).toBeDefined();
    expect(w03!.reworkDays).toBeCloseTo(5);
    expect(w03!.reworkedIssues).toBe(1);
    expect(w04).toBeDefined();
    expect(w04!.reworkDays).toBeCloseTo(3);
  });

  it("impute le coût rework sur 1 seule semaine pour une passe courte", () => {
    // Rework 2j-ouvrés : mer 2025-01-08 → ven 2025-01-10 (W02)
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-06T10:00:00Z" },
      { to: "In Review",   at: "2025-01-06T11:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // rework start (mer W02)
      { to: "Done",        at: "2025-01-10T09:00:00Z" }, // 2j (mer+jeu)
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].week).toBe("2025-W02");
    expect(result.byWeek[0].reworkDays).toBeCloseTo(2);
    expect(result.byWeek[0].reworkedIssues).toBe(1);
  });

  // Règle 4 — Attribution sprint

  it("attribue le coût rework au sprint actif à la date de fin de la passe", () => {
    seedSprint(db, makeSprint({ id: 1, name: "Sprint 1", startDate: "2025-01-13T00:00:00.000Z", endDate: "2025-01-26T00:00:00.000Z" }));
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-06T10:00:00Z" },
      { to: "In Review",   at: "2025-01-06T11:00:00Z" },
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // rework start
      { to: "Done",        at: "2025-01-15T09:00:00Z" }, // end dans Sprint 1
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.bySprint).toHaveLength(1);
    expect(result.bySprint[0].sprintId).toBe(1);
    expect(result.bySprint[0].sprintName).toBe("Sprint 1");
    expect(result.bySprint[0].reworkDays).toBeCloseTo(2);
    expect(result.bySprint[0].reworkedIssues).toBe(1);
  });

  it("exclut du bySprint un rework hors plage sprint mais compte dans les agrégats globaux", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-06T10:00:00Z" },
      { to: "In Review",   at: "2025-01-06T11:00:00Z" },
      { to: "In Progress", at: "2025-01-13T09:00:00Z" }, // rework
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.bySprint).toEqual([]);
    expect(result.totalReworkDays).toBeGreaterThan(0);
  });

  // Cas limites

  it("avgReworkDaysPerReworkedTicket et reworkCostRatio = 0 quand reworkedCount = 0", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-07T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkedCount).toBe(0);
    expect(result.avgReworkDaysPerReworkedTicket).toBe(0);
    expect(result.reworkCostRatio).toBe(0);
  });

  it("aucun rôle configuré → reworkedCount = 0 et byWeek vide", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-07T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const result = reworkCostMetric.compute(createTestContext(db, TEST_CONFIG)); // pas de devStatuses/qaStatuses
    expect(result.reworkedCount).toBe(0);
    expect(result.byWeek).toEqual([]);
    expect(result.bySprint).toEqual([]);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { handoffReworkMetric } from "../../src/metrics/handoffRework";
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

// Fixture nominale : todo → dev → qa → done (0 rework)
function seedNoRework(key = "PROJ-1") {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",        at: "2025-01-06T09:00:00Z" },
    { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
    { to: "In Review",    at: "2025-01-10T09:00:00Z" },
    { to: "Done",         at: "2025-01-14T09:00:00Z" },
  ]);
}

describe("handoffReworkMetric.compute", () => {
  it("retourne count 0 si aucune issue livrée", () => {
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(0);
    expect(result.reworkRatio).toBe(0);
    expect(result.avgReworks).toBe(0);
    expect(result.byReworkType).toEqual({ qaToDev: 0, poToQa: 0, poDev: 0 });
    expect(result.issues).toEqual([]);
  });

  it("retourne 0 rework pour ticket nominal dev → qa → done", () => {
    seedNoRework();
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(0);
    expect(result.avgReworks).toBe(0);
    expect(result.byReworkType).toEqual({ qaToDev: 0, poToQa: 0, poDev: 0 });
    expect(result.issues).toEqual([]);
  });

  it("détecte un rework qa → dev", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" }, // rework qa→dev
      { to: "Done",         at: "2025-01-14T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(1);
    expect(result.avgReworks).toBe(1);
    expect(result.byReworkType.qaToDev).toBe(1);
    expect(result.byReworkType.poToQa).toBe(0);
    expect(result.byReworkType.poDev).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issueKey).toBe("PROJ-1");
    expect(result.issues[0].reworkCount).toBe(1);
    expect(result.issues[0].reworkTypes).toEqual(["qaToDev"]);
  });

  it("détecte un rework po → qa", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",          at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",    at: "2025-01-08T09:00:00Z" },
      { to: "In Review",      at: "2025-01-10T09:00:00Z" },
      { to: "Validation PO",  at: "2025-01-13T09:00:00Z" },
      { to: "In Review",      at: "2025-01-14T09:00:00Z" }, // rework po→qa
      { to: "Done",           at: "2025-01-16T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(1);
    expect(result.byReworkType.poToQa).toBe(1);
    expect(result.byReworkType.qaToDev).toBe(0);
    expect(result.issues[0].reworkTypes).toEqual(["poToQa"]);
  });

  it("détecte un rework po → dev (saut)", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",          at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",    at: "2025-01-08T09:00:00Z" },
      { to: "Validation PO",  at: "2025-01-10T09:00:00Z" },
      { to: "In Progress",    at: "2025-01-13T09:00:00Z" }, // rework po→dev
      { to: "Done",           at: "2025-01-14T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(1);
    expect(result.byReworkType.poDev).toBe(1);
    expect(result.byReworkType.qaToDev).toBe(0);
    expect(result.issues[0].reworkTypes).toEqual(["poDev"]);
  });

  it("compte correctement plusieurs reworks sur un même ticket", () => {
    // dev → qa → dev → qa → done : 2 reworks qa→dev
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" }, // rework 1 qa→dev
      { to: "In Review",    at: "2025-01-14T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-15T09:00:00Z" }, // rework 2 qa→dev
      { to: "Done",         at: "2025-01-16T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.byReworkType.qaToDev).toBe(2);
    expect(result.avgReworks).toBe(2);
    expect(result.issues[0].reworkCount).toBe(2);
    expect(result.issues[0].reworkTypes).toEqual(["qaToDev", "qaToDev"]);
  });

  it("dev → none → dev n'est pas un rework (prevRole conservé à travers none)", () => {
    // dev → To Do (none) → dev → done : aucun rôle amont traversé, pas de rework
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "To Do",        at: "2025-01-10T09:00:00Z" }, // none (pas un rôle)
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" }, // retour dev, pas rework
      { to: "Done",         at: "2025-01-14T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(0);
    expect(result.byReworkType.qaToDev).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("qa → none → dev est un rework qaToDev (prevRole = qa à travers none)", () => {
    // qa → To Do (none) → dev : dernier rôle non-null avant dev était qa → rework
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" }, // qa
      { to: "To Do",        at: "2025-01-13T09:00:00Z" }, // none
      { to: "In Progress",  at: "2025-01-14T09:00:00Z" }, // dev → rework
      { to: "Done",         at: "2025-01-15T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(1);
    expect(result.byReworkType.qaToDev).toBe(1);
  });

  it("rôle QA non configuré → pas de rework qaToDev même si transitions qa→dev présentes", () => {
    const noQaConfig: MetricConfig = {
      ...ROLE_CONFIG,
      qaStatuses: [],
    };
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" }, // In Review non reconnu comme qa
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" },
      { to: "Done",         at: "2025-01-14T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, noQaConfig));
    expect(result.count).toBe(1);
    expect(result.reworkRatio).toBe(0);
    expect(result.byReworkType.qaToDev).toBe(0);
  });

  it("agrège correctement plusieurs tickets (ratio et moyenne)", () => {
    // PROJ-1 : 0 rework
    seedNoRework("PROJ-1");
    // PROJ-2 : 1 rework qa→dev
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" },
      { to: "Done",         at: "2025-01-14T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.count).toBe(2);
    expect(result.reworkRatio).toBeCloseTo(0.5);
    expect(result.avgReworks).toBeCloseTo(0.5);
    expect(result.byReworkType.qaToDev).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issueKey).toBe("PROJ-2");
  });

  it("issues triées par reworkCount décroissant", () => {
    // PROJ-1 : 1 rework
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" },
      { to: "Done",         at: "2025-01-14T09:00:00Z" },
    ]);
    // PROJ-2 : 2 reworks
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",        at: "2025-01-06T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-08T09:00:00Z" },
      { to: "In Review",    at: "2025-01-10T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-13T09:00:00Z" },
      { to: "In Review",    at: "2025-01-14T09:00:00Z" },
      { to: "In Progress",  at: "2025-01-15T09:00:00Z" },
      { to: "Done",         at: "2025-01-16T09:00:00Z" },
    ]);
    const result = handoffReworkMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.issues[0].issueKey).toBe("PROJ-2");
    expect(result.issues[1].issueKey).toBe("PROJ-1");
  });
});

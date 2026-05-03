import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, makeSprint, seedSprint, resetSeq } from "../helpers/seeders";
import { upsertIssues } from "../../src/db/store";
import { wipMetric } from "../../src/metrics/wip";
import { TEST_CONFIG } from "../helpers/seeders";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

describe("wipMetric.compute", () => {
  it("retourne currentWip=0 et sprintName=null sans sprint actif", () => {
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.currentWip).toBe(0);
    expect(result.sprintName).toBeNull();
    expect(result.issueKeys).toHaveLength(0);
  });

  it("retourne currentWip=0 si sprint actif mais aucune issue In Progress", () => {
    const sprint = makeSprint({ id: 1, state: "active" });
    seedSprint(db, sprint);
    upsertIssues(db, [makeIssue({ key: "PROJ-1", currentSprintId: 1, currentStatus: "To Do" })]);
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.currentWip).toBe(0);
  });

  it("compte les issues In Progress dans le sprint actif", () => {
    const sprint = makeSprint({ id: 1, state: "active", name: "Sprint Alpha" });
    seedSprint(db, sprint);
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentSprintId: 1, currentStatus: "In Progress" }),
      makeIssue({ key: "PROJ-2", currentSprintId: 1, currentStatus: "In Progress" }),
    ]);
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.currentWip).toBe(2);
    expect(result.sprintName).toBe("Sprint Alpha");
  });

  it("exclut les issues d'un autre statut (non In Progress)", () => {
    const sprint = makeSprint({ id: 1, state: "active" });
    seedSprint(db, sprint);
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentSprintId: 1, currentStatus: "In Progress" }),
      makeIssue({ key: "PROJ-2", currentSprintId: 1, currentStatus: "Done" }),
      makeIssue({ key: "PROJ-3", currentSprintId: 1, currentStatus: "To Do" }),
    ]);
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.currentWip).toBe(1);
    expect(result.issueKeys).toEqual(["PROJ-1"]);
  });

  it("exclut les issues d'un sprint fermé même si In Progress", () => {
    const closed = makeSprint({ id: 2, state: "closed" });
    const active = makeSprint({ id: 1, state: "active" });
    seedSprint(db, closed);
    seedSprint(db, active);
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentSprintId: 2, currentStatus: "In Progress" }), // sprint fermé
      makeIssue({ key: "PROJ-2", currentSprintId: 1, currentStatus: "In Progress" }), // sprint actif
    ]);
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.currentWip).toBe(1);
    expect(result.issueKeys).toEqual(["PROJ-2"]);
  });

  it("retourne les issueKeys corrects", () => {
    const sprint = makeSprint({ id: 1, state: "active" });
    seedSprint(db, sprint);
    upsertIssues(db, [
      makeIssue({ key: "PROJ-3", currentSprintId: 1, currentStatus: "In Progress" }),
      makeIssue({ key: "PROJ-7", currentSprintId: 1, currentStatus: "In Progress" }),
    ]);
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.issueKeys).toHaveLength(2);
    expect(result.issueKeys).toContain("PROJ-3");
    expect(result.issueKeys).toContain("PROJ-7");
  });

  it("inProgressStatuses inclut 'In Review' aussi", () => {
    const sprint = makeSprint({ id: 1, state: "active" });
    seedSprint(db, sprint);
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentSprintId: 1, currentStatus: "In Review" }),
    ]);
    const result = wipMetric.compute(db, TEST_CONFIG);
    expect(result.currentWip).toBe(1);
  });

  it("excludeIssueTypes exclut Feature et Epic du WIP", () => {
    const sprint = makeSprint({ id: 1, state: "active" });
    seedSprint(db, sprint);
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentSprintId: 1, currentStatus: "In Progress", issueType: "Feature" }),
      makeIssue({ key: "PROJ-2", currentSprintId: 1, currentStatus: "In Progress", issueType: "Epic" }),
      makeIssue({ key: "PROJ-3", currentSprintId: 1, currentStatus: "In Progress", issueType: "Story" }),
    ]);
    const result = wipMetric.compute(db, { ...TEST_CONFIG, excludeIssueTypes: ["Feature", "Epic"] });
    expect(result.currentWip).toBe(1);
    expect(result.issueKeys).toEqual(["PROJ-3"]);
  });
});

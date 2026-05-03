import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { devTimeAllocationMetric } from "../../src/metrics/devTimeAllocation";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Fixture : To Do lundi, In Progress mercredi, Done vendredi → cycle = 2j ouvrés
function seedFeature(key: string, doneAt = "2025-01-10T09:00:00Z") {
  seedIssueWithTransitions(db, makeIssue({ key, issueType: "Story" }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" },
    { to: "Done",        at: doneAt },
  ]);
}

function seedBug(key: string, doneAt = "2025-01-10T09:00:00Z") {
  seedIssueWithTransitions(db, makeIssue({ key, issueType: "Bug" }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" },
    { to: "Done",        at: doneAt },
  ]);
}

describe("devTimeAllocationMetric.compute", () => {
  it("retourne vide quand aucune issue livrée", () => {
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(0);
    expect(result.avgBugRatio).toBe(0);
  });

  it("feature contribue aux featureDays, bugDays = 0", () => {
    seedFeature("PROJ-1"); // cycle 2j, done vendredi 2025-01-10
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].featureDays).toBe(2);
    expect(result.byWeek[0].bugDays).toBe(0);
    expect(result.byWeek[0].bugRatio).toBe(0);
  });

  it("bug contribue aux bugDays, featureDays = 0", () => {
    seedBug("PROJ-1"); // cycle 2j
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].bugDays).toBe(2);
    expect(result.byWeek[0].featureDays).toBe(0);
    expect(result.byWeek[0].bugRatio).toBe(1);
  });

  it("bugIssueTypes vide → tout en featureDays, bugDays = 0", () => {
    seedFeature("PROJ-1");
    seedBug("PROJ-2");
    const cfg = { ...TEST_CONFIG, bugIssueTypes: [] };
    const result = devTimeAllocationMetric.compute(db, cfg);
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].bugDays).toBe(0);
    expect(result.byWeek[0].bugRatio).toBe(0);
    expect(result.byWeek[0].featureDays).toBe(4); // 2j + 2j
  });

  it("issue sans devStart exclue", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Story" }), [
      { to: "To Do", at: "2025-01-06T09:00:00Z" },
      { to: "Done",  at: "2025-01-10T09:00:00Z" },
    ]);
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(0);
  });

  it("issue sans todo exclue", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Story" }), [
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(0);
  });

  it("distribution multi-semaine : 13j bug W02→W04 réparti 5+5+3 sur 3 semaines", () => {
    // Bug démarré lun 2025-01-06 (W02), livré jeu 2025-01-23 (W04) = 13j ouvrés
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Bug" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-06T09:00:00Z" },
      { to: "Done",        at: "2025-01-23T09:00:00Z" },
    ]);
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(3);
    const w02 = result.byWeek.find((w) => w.week === "2025-W02");
    const w03 = result.byWeek.find((w) => w.week === "2025-W03");
    const w04 = result.byWeek.find((w) => w.week === "2025-W04");
    expect(w02?.bugDays).toBe(5);
    expect(w03?.bugDays).toBe(5);
    expect(w04?.bugDays).toBe(3);
    expect(w02?.featureDays).toBe(0);
  });

  it("bugRatio correct pour semaine mixte feature + bug", () => {
    // Feature 3j + Bug 2j dans W15 (tout en intra-semaine → 1 seule entrée)
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Story" }), [
      { to: "To Do",       at: "2025-04-08T09:00:00Z" },
      { to: "In Progress", at: "2025-04-08T09:00:00Z" },
      { to: "Done",        at: "2025-04-11T09:00:00Z" }, // 3j ouvrés (Tue→Fri)
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2", issueType: "Bug" }), [
      { to: "To Do",       at: "2025-04-09T09:00:00Z" },
      { to: "In Progress", at: "2025-04-09T09:00:00Z" },
      { to: "Done",        at: "2025-04-11T09:00:00Z" }, // 2j ouvrés (Wed→Fri)
    ]);
    const cfg = { ...TEST_CONFIG, cutoffDate: "2025-04-01" };
    const result = devTimeAllocationMetric.compute(db, cfg);
    expect(result.byWeek).toHaveLength(1);
    const w = result.byWeek[0];
    expect(w.featureDays).toBe(3);
    expect(w.bugDays).toBe(2);
    expect(w.bugRatio).toBeCloseTo(2 / 5, 5);
    expect(result.avgBugRatio).toBeCloseTo(2 / 5, 5);
  });

  it("cycle time négatif (done_at < started_at) ignoré silencieusement", () => {
    // Anomalie données : done avant In Progress
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Story" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "Done",        at: "2025-01-07T09:00:00Z" },
      { to: "In Progress", at: "2025-01-10T09:00:00Z" }, // devStart après done
    ]);
    const result = devTimeAllocationMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(0);
  });
});

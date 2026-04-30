import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { cycleTimeMetric } from "../../src/metrics/cycleTime";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Fixture canonique : To Do lundi, In Progress mercredi, Done vendredi → cycle = 2j ouvrés
function seedCanonical(key = "PROJ-1") {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",       at: "2025-01-06T09:00:00Z" },
    { to: "In Progress", at: "2025-01-08T09:00:00Z" },
    { to: "Done",        at: "2025-01-10T09:00:00Z" },
  ]);
}

describe("cycleTimeMetric.compute", () => {
  it("retourne stats vides quand aucune issue livrée", () => {
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("durée correcte pour l'issue canonique (2 jours ouvrés)", () => {
    seedCanonical();
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(1);
    expect(result.issues[0].cycleTimeDays).toBe(2);
    expect(result.avgDays).toBe(2);
    expect(result.medianDays).toBe(2);
  });

  it("exclut une issue sans transition todoStatus (pas dans la population)", () => {
    // Transition In Progress → Done mais pas de "To Do"
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("exclut une issue sans transition devStartStatus", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do", at: "2025-01-06T09:00:00Z" },
      { to: "Done",  at: "2025-01-10T09:00:00Z" },
    ]);
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("exclut une issue où done_at < started_at (anomalie données)", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "Done",        at: "2025-01-07T09:00:00Z" }, // done avant dev start
      { to: "In Progress", at: "2025-01-10T09:00:00Z" }, // dev start après done
    ]);
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(0);
  });

  it("cutoffDate exclut les issues livrées avant la date", () => {
    seedCanonical(); // done 2025-01-10
    const cfg = { ...TEST_CONFIG, cutoffDate: "2025-01-11" };
    const result = cycleTimeMetric.compute(db, cfg);
    expect(result.count).toBe(0);
  });

  it("cutoffDate inclut les issues livrées exactement à la date", () => {
    seedCanonical(); // done 2025-01-10
    const cfg = { ...TEST_CONFIG, cutoffDate: "2025-01-10" };
    const result = cycleTimeMetric.compute(db, cfg);
    expect(result.count).toBe(1);
  });

  it("windowEndDate exclut les issues livrées après la fenêtre", () => {
    seedCanonical(); // done 2025-01-10
    const cfg = { ...TEST_CONFIG, windowEndDate: "2025-01-09" };
    const result = cycleTimeMetric.compute(db, cfg);
    expect(result.count).toBe(0);
  });

  it("windowEndDate inclut les issues livrées dans la fenêtre", () => {
    seedCanonical(); // done 2025-01-10
    // "2025-01-10T09:00:00Z" < "2025-01-11" lexicographiquement → inclus
    const cfg = { ...TEST_CONFIG, windowEndDate: "2025-01-11" };
    const result = cycleTimeMetric.compute(db, cfg);
    expect(result.count).toBe(1);
  });

  it("plusieurs doneStatuses dans le CTE", () => {
    // Done via statut "Delivered" (second doneStatus)
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Delivered",   at: "2025-01-10T09:00:00Z" },
    ]);
    const cfg = { ...TEST_CONFIG, doneStatuses: ["Done", "Delivered"] };
    const result = cycleTimeMetric.compute(db, cfg);
    expect(result.count).toBe(1);
  });

  it("prend MIN(started_at) quand plusieurs transitions devStart", () => {
    // Re-entre en In Progress : on prend la 1ère
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // 1ère
      { to: "In Review",   at: "2025-01-09T09:00:00Z" },
      { to: "In Progress", at: "2025-01-09T12:00:00Z" }, // 2ème
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(1);
    // startedAt doit être la 1ère (Jan 8)
    expect(result.issues[0].startedAt).toBe("2025-01-08T09:00:00Z");
  });

  it("stats correctes sur 3 issues", () => {
    // 3 issues avec cycles 2, 4, 6 jours ouvrés
    // PROJ-1: In Progress Jan 8 (Wed) → Done Jan 10 (Fri) = 2j
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    // PROJ-2: In Progress Jan 8 (Wed) → Done Jan 14 (Tue) = 4j (Wed,Thu,Fri,Mon)
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    // PROJ-3: In Progress Jan 6 (Mon) → Done Jan 14 (Tue) = 6j
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-3" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-06T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = cycleTimeMetric.compute(db, TEST_CONFIG);
    expect(result.count).toBe(3);
    const days = result.issues.map((i) => i.cycleTimeDays).sort((a, b) => a - b);
    expect(days[0]).toBe(2);
    // median = 4
    expect(result.medianDays).toBe(4);
  });
});

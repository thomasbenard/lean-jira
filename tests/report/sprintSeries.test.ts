import { describe, it, expect, beforeEach } from "vitest";
import { buildSprintSeries } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import { createTestDb } from "../helpers/db";
import { SqliteStore } from "../../src/store/sqlite";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";

beforeEach(() => { initLocale("en"); });

describe("buildSprintSeries", () => {
  beforeEach(() => { resetSeq(); });

  it("retourne des séries vides si aucun sprint", () => {
    const db = createTestDb();
    const result = buildSprintSeries(new SqliteStore(db), TEST_CONFIG, []);
    expect(result.throughput.labels).toHaveLength(0);
    expect(result.throughput.series.count).toHaveLength(0);
    expect(result.bugThroughput.labels).toHaveLength(0);
    expect(result.throughputWeighted.labels).toHaveLength(0);
    expect(result.throughput.hasActiveSprint).toBe(false);
  });

  it("agrège le throughput par sprint pour 2 sprints terminés", () => {
    const db = createTestDb();
    seedIssueWithTransitions(db, makeIssue({ key: "P-1" }), [
      { to: "In Progress", at: "2025-01-07T10:00:00.000Z" },
      { to: "Done", at: "2025-01-10T10:00:00.000Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "P-2" }), [
      { to: "In Progress", at: "2025-01-08T10:00:00.000Z" },
      { to: "Done", at: "2025-01-12T10:00:00.000Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "P-3" }), [
      { to: "In Progress", at: "2025-01-21T10:00:00.000Z" },
      { to: "Done", at: "2025-01-25T10:00:00.000Z" },
    ]);

    const sprints = [
      { name: "Sprint 1", state: "closed", start_date: "2025-01-06", end_date: "2025-01-20" },
      { name: "Sprint 2", state: "closed", start_date: "2025-01-20", end_date: "2025-02-03" },
    ];
    const result = buildSprintSeries(new SqliteStore(db), TEST_CONFIG, sprints);

    expect(result.throughput.labels).toEqual(["Sprint 1", "Sprint 2"]);
    expect(result.throughput.series.count).toEqual([2, 1]);
    expect(result.throughput.hasActiveSprint).toBe(false);
  });

  it("sprint actif : hasActiveSprint = true, label contient '(en cours)'", () => {
    const db = createTestDb();
    seedIssueWithTransitions(db, makeIssue({ key: "P-1" }), [
      { to: "In Progress", at: "2025-01-07T10:00:00.000Z" },
      { to: "Done", at: "2025-01-10T10:00:00.000Z" },
    ]);

    const sprints = [
      { name: "Sprint Actif", state: "active", start_date: "2025-01-06", end_date: null },
    ];
    const result = buildSprintSeries(new SqliteStore(db), TEST_CONFIG, sprints);

    expect(result.throughput.hasActiveSprint).toBe(true);
    expect(result.throughput.labels[0]).toContain("Sprint Actif");
    expect(result.throughput.labels[0]).toContain("(en cours)");
    expect(result.throughput.series.count[0]).toBeGreaterThanOrEqual(0);
  });

  it("sprint avec 0 livraisons → valeur 0 (pas d'erreur)", () => {
    const db = createTestDb();
    const sprints = [
      { name: "Sprint Vide", state: "closed", start_date: "2025-01-06", end_date: "2025-01-20" },
    ];
    const result = buildSprintSeries(new SqliteStore(db), TEST_CONFIG, sprints);

    expect(result.throughput.labels).toEqual(["Sprint Vide"]);
    expect(result.throughput.series.count).toEqual([0]);
  });

  it("respecte config.cutoffDate quand sprint.start_date est antérieur (bug sprint 0)", () => {
    // pourquoi : sprint 0 dont start_date < cutoffDate ne doit pas inclure les
    // tickets livrés avant cutoffDate (ex : bulk-close 2025-10-25 sur KECK).
    // Sans le fix, sprintSeries override cutoffDate par sprint.start_date et
    // pollue la population avec des cycle-times aberrants.
    const db = createTestDb();
    seedIssueWithTransitions(db, makeIssue({ key: "OLD-1" }), [
      { to: "In Progress", at: "2025-01-15T10:00:00.000Z" },
      { to: "Done",        at: "2025-01-18T10:00:00.000Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "NEW-1" }), [
      { to: "In Progress", at: "2025-02-03T10:00:00.000Z" },
      { to: "Done",        at: "2025-02-05T10:00:00.000Z" },
    ]);

    const cfg = { ...TEST_CONFIG, cutoffDate: "2025-02-01" };
    const sprints = [
      { name: "Sprint 0", state: "closed", start_date: "2025-01-10", end_date: "2025-02-10" },
    ];
    const result = buildSprintSeries(new SqliteStore(db), cfg, sprints);

    expect(result.throughput.series.count).toEqual([1]);
    expect(result.cycleTime.series.median[0]).toBeGreaterThan(0);
    expect(result.cycleTime.series.p85[0]).toBeLessThan(5);
  });

  it("expose bugCycleTime (median + p85) par sprint sur la population bug", () => {
    const db = createTestDb();
    seedIssueWithTransitions(db, makeIssue({ key: "P-1", issueType: "Bug" }), [
      { to: "In Progress", at: "2025-01-07T10:00:00.000Z" },
      { to: "Done", at: "2025-01-10T10:00:00.000Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "P-2", issueType: "Story" }), [
      { to: "In Progress", at: "2025-01-08T10:00:00.000Z" },
      { to: "Done", at: "2025-01-15T10:00:00.000Z" },
    ]);

    const sprints = [
      { name: "Sprint 1", state: "closed", start_date: "2025-01-06", end_date: "2025-01-20" },
    ];
    const result = buildSprintSeries(new SqliteStore(db), TEST_CONFIG, sprints);

    expect(result.bugCycleTime.labels).toEqual(["Sprint 1"]);
    expect(result.bugCycleTime.series.median).toHaveLength(1);
    expect(result.bugCycleTime.series.p85).toHaveLength(1);
    expect(result.bugCycleTime.series.median[0]).toBeGreaterThan(0);
  });

  it("expose devTimeAllocation (featureDays + bugDays + bugRatio) par sprint", () => {
    const db = createTestDb();
    seedIssueWithTransitions(db, makeIssue({ key: "F-1", issueType: "Story" }), [
      { to: "In Progress", at: "2025-01-07T10:00:00.000Z" },
      { to: "Done", at: "2025-01-10T10:00:00.000Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "B-1", issueType: "Bug" }), [
      { to: "In Progress", at: "2025-01-08T10:00:00.000Z" },
      { to: "Done", at: "2025-01-09T10:00:00.000Z" },
    ]);

    const sprints = [
      { name: "Sprint 1", state: "closed", start_date: "2025-01-06", end_date: "2025-01-20" },
    ];
    const result = buildSprintSeries(new SqliteStore(db), TEST_CONFIG, sprints);

    expect(result.devTimeAllocation.labels).toEqual(["Sprint 1"]);
    expect(result.devTimeAllocation.series.featureDays[0]).toBeGreaterThan(0);
    expect(result.devTimeAllocation.series.bugDays[0]).toBeGreaterThan(0);
    expect(result.devTimeAllocation.series.bugRatio[0]).toBeGreaterThan(0);
    expect(result.devTimeAllocation.series.bugRatio[0]).toBeLessThanOrEqual(1);
  });
});

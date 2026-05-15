import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { bugBacklogMetric } from "../../src/metrics/bugBacklog";
import type Database from "better-sqlite3";
import { SqliteStore } from "../../src/store/sqlite";
import { createTestContext } from "../_helpers/createTestContext";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

const END_DATE = "2025-06-01";
const WINDOW_CONFIG = { ...TEST_CONFIG, windowEndDate: END_DATE };

describe("bugBacklogMetric — openCount", () => {
  it("inclut un bug sans aucune transition", () => {
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" })]);
    const result = bugBacklogMetric.compute(createTestContext(db, WINDOW_CONFIG));
    expect(result.openCount).toBe(1);
  });

  it("exclut un bug fermé avec transition done avant D", () => {
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" }),
      [{ to: "Done", at: "2025-03-01T09:00:00Z" }],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, WINDOW_CONFIG));
    expect(result.openCount).toBe(0);
  });

  it("inclut un bug fermé puis rouvert dont le dernier statut avant D n'est pas done", () => {
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" }),
      [
        { to: "Done", at: "2025-03-01T09:00:00Z" },
        { to: "In Progress", at: "2025-04-01T09:00:00Z" },
      ],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, WINDOW_CONFIG));
    expect(result.openCount).toBe(1);
  });

  it("n'inclut pas un bug créé après D", () => {
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-07-01T00:00:00Z" })]);
    const result = bugBacklogMetric.compute(createTestContext(db, WINDOW_CONFIG));
    expect(result.openCount).toBe(0);
  });

  it("bug rouvert : openCount déterministe quel que soit l'ordre de stockage des transitions", () => {
    // Insère les transitions en ordre inverse pour exposer le SELECT to_status + MAX non-corrélé
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-REOPEN", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" }),
      [
        { to: "In Progress", at: "2025-04-01T09:00:00Z" },
        { to: "Done",        at: "2025-03-01T09:00:00Z" },
      ],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, WINDOW_CONFIG));
    expect(result.openCount).toBe(1);
  });

  it("n'inclut pas les non-bugs dans openCount", () => {
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "STORY-1", issueType: "Story", createdAt: "2025-01-01T00:00:00Z" })]);
    const result = bugBacklogMetric.compute(createTestContext(db, WINDOW_CONFIG));
    expect(result.openCount).toBe(0);
  });
});

describe("bugBacklogMetric — netFlow / created / closed", () => {
  const FLOW_CONFIG = { ...TEST_CONFIG, cutoffDate: "2025-05-28", windowEndDate: "2025-06-03" };

  it("closed = 1 pour un bug fermé une fois dans la fenêtre", () => {
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" }),
      [{ to: "Done", at: "2025-06-03T09:00:00Z" }],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, FLOW_CONFIG));
    expect(result.closed).toBe(1);
  });

  it("closed = 1 même si bug fermé deux fois (première transition done compte)", () => {
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" }),
      [
        { to: "Done", at: "2025-06-01T09:00:00Z" },
        { to: "In Progress", at: "2025-06-01T10:00:00Z" },
        { to: "Done", at: "2025-06-02T09:00:00Z" },
      ],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, FLOW_CONFIG));
    expect(result.closed).toBe(1);
  });

  it("closed = 0 si bug fermé hors fenêtre", () => {
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" }),
      [{ to: "Done", at: "2025-05-01T09:00:00Z" }],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, FLOW_CONFIG));
    expect(result.closed).toBe(0);
  });

  it("netFlow = closed - created", () => {
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "BUG-NEW1", issueType: "Bug", createdAt: "2025-05-29T00:00:00Z" })]);
    seedIssueWithTransitions(
      db,
      makeIssue({ key: "BUG-NEW2", issueType: "Bug", createdAt: "2025-05-30T00:00:00Z" }),
      [{ to: "Done", at: "2025-06-02T09:00:00Z" }],
    );
    const result = bugBacklogMetric.compute(createTestContext(db, FLOW_CONFIG));
    expect(result.created).toBe(2);
    expect(result.closed).toBe(1);
    expect(result.netFlow).toBe(-1);
  });
});

describe("bugBacklogMetric — cas limites", () => {
  it("retourne zéros si bugIssueTypes vide", () => {
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" })]);
    const result = bugBacklogMetric.compute(createTestContext(db, { ...TEST_CONFIG, bugIssueTypes: [] }));
    expect(result).toEqual({ openCount: 0, netFlow: 0, created: 0, closed: 0 });
  });

  it("retourne zéros si doneStatuses vide → tous les bugs comptent comme ouverts", () => {
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "BUG-1", issueType: "Bug", createdAt: "2025-01-01T00:00:00Z" })]);
    const result = bugBacklogMetric.compute(createTestContext(db, { ...WINDOW_CONFIG, doneStatuses: [] }));
    expect(result.openCount).toBe(1);
  });
});

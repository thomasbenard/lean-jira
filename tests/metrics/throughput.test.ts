import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { throughputMetric } from "../../src/metrics/throughput";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Seed une issue livrée à une date précise (juste besoin de la transition Done)
function seedDelivered(key: string, doneAt: string) {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "Done", at: doneAt },
  ]);
}

describe("throughputMetric.compute", () => {
  it("retourne byWeek vide et avgPerWeek=0 sans données", () => {
    const result = throughputMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(0);
    expect(result.avgPerWeek).toBe(0);
  });

  it("2 issues même semaine → count=2 pour cette semaine", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z"); // lundi sem W01
    seedDelivered("PROJ-2", "2025-01-07T09:00:00Z"); // mardi sem W01
    const result = throughputMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].count).toBe(2);
  });

  it("2 semaines différentes → 2 lignes ordonnées ASC", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z"); // W01
    seedDelivered("PROJ-2", "2025-01-13T09:00:00Z"); // W02
    const result = throughputMetric.compute(db, TEST_CONFIG);
    expect(result.byWeek).toHaveLength(2);
    expect(result.byWeek[0].week).toBe("2025-W01");
    expect(result.byWeek[1].week).toBe("2025-W02");
  });

  it("avgPerWeek = total / nb semaines", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z"); // W01
    seedDelivered("PROJ-2", "2025-01-07T09:00:00Z"); // W01
    seedDelivered("PROJ-3", "2025-01-13T09:00:00Z"); // W02 → total=3, weeks=2, avg=1.5
    const result = throughputMetric.compute(db, TEST_CONFIG);
    expect(result.avgPerWeek).toBe(1.5);
  });

  it("cutoffDate exclut les issues livrées avant", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z"); // W01
    seedDelivered("PROJ-2", "2025-01-13T09:00:00Z"); // W02
    const result = throughputMetric.compute(db, { ...TEST_CONFIG, cutoffDate: "2025-01-10" });
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].week).toBe("2025-W02");
  });

  it("windowEndDate exclut les issues livrées après", () => {
    seedDelivered("PROJ-1", "2025-01-06T09:00:00Z"); // W01
    seedDelivered("PROJ-2", "2025-01-13T09:00:00Z"); // W02
    const result = throughputMetric.compute(db, { ...TEST_CONFIG, windowEndDate: "2025-01-10" });
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].week).toBe("2025-W01");
  });
});

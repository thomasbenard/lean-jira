import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { forecastMetric } from "../../src/metrics/forecast";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Seed N issues livrées le même lundi (même semaine SQLite)
function seedWeek(weekMonday: string, count: number, startSeq: number) {
  for (let i = 0; i < count; i++) {
    const key = `PROJ-${startSeq + i}`;
    seedIssueWithTransitions(db, makeIssue({ key }), [
      { to: "Done", at: `${weekMonday}T09:00:00Z` },
    ]);
  }
}

// Seed un pool uniforme : N issues/semaine pendant `weeks` semaines consécutives.
// Dates : semaines ISO 2025-W01 à 2025-W{weeks}.
// Pool = tableau de longueur `weeks` où chaque entrée = issuesPerWeek.
// Toute simulation N-week sum = N * issuesPerWeek → percentiles déterministes.
const MONDAYS_2025 = [
  "2025-01-06", "2025-01-13", "2025-01-20", "2025-01-27",
  "2025-02-03", "2025-02-10", "2025-02-17", "2025-02-24",
  "2025-03-03", "2025-03-10", "2025-03-17", "2025-03-24",
];

function seedUniformPool(issuesPerWeek: number, weeks: number) {
  let seq = 1;
  for (let w = 0; w < weeks; w++) {
    seedWeek(MONDAYS_2025[w], issuesPerWeek, seq);
    seq += issuesPerWeek;
  }
}

describe("forecastMetric.compute", () => {
  it("retourne résultat vide si aucune données", () => {
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.recentWeeks).toHaveLength(0);
    expect(result.weeksUsed).toBe(0);
    expect(result.byHorizon).toHaveLength(0);
    expect(result.simulations).toBe(0);
  });

  it("byHorizon contient exactement [1,2,4,8] semaines", () => {
    seedUniformPool(3, 4);
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.byHorizon.map((h) => h.weeks)).toEqual([1, 2, 4, 8]);
  });

  it("simulations = 10000", () => {
    seedUniformPool(3, 4);
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.simulations).toBe(10_000);
  });

  it("recentWeeks en ordre chronologique (le plus ancien en premier)", () => {
    seedUniformPool(2, 3);
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    // recentWeeks = samples.reverse() dans le code (ORDER DESC puis reverse)
    expect(result.recentWeeks).toHaveLength(3);
    // tous égaux dans un pool uniforme
    result.recentWeeks.forEach((v) => expect(v).toBe(2));
  });

  it("pool uniforme → tous les percentiles déterministes par horizon", () => {
    const iPerWeek = 5;
    seedUniformPool(iPerWeek, 4);
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    // Chaque simulation tire toujours `iPerWeek` → sum = weeks * iPerWeek
    for (const h of result.byHorizon) {
      const expected = h.weeks * iPerWeek;
      expect(h.p15).toBe(expected);
      expect(h.p50).toBe(expected);
      expect(h.p85).toBe(expected);
      expect(h.p95).toBe(expected);
    }
  });

  it("p15 <= p50 <= p85 <= p95 pour tout pool non-uniforme", () => {
    // Pool non-uniforme : semaines avec 1, 5, 10, 3 issues
    const counts = [1, 5, 10, 3];
    let seq = 1;
    counts.forEach((c, i) => {
      seedWeek(MONDAYS_2025[i], c, seq);
      seq += c;
    });
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    for (const h of result.byHorizon) {
      expect(h.p15).toBeLessThanOrEqual(h.p50);
      expect(h.p50).toBeLessThanOrEqual(h.p85);
      expect(h.p85).toBeLessThanOrEqual(h.p95);
    }
  });

  it("weeksUsed = nb semaines en DB (max 12)", () => {
    seedUniformPool(2, 6);
    const result = forecastMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.weeksUsed).toBe(6);
  });

  it("windowEndDate exclut les semaines après la fenêtre", () => {
    seedWeek("2025-01-06", 3, 1);  // W01
    seedWeek("2025-01-13", 5, 10); // W02
    const result = forecastMetric.compute(createTestContext(db, {
      ...TEST_CONFIG,
      windowEndDate: "2025-01-10", // avant W02
    }));
    expect(result.weeksUsed).toBe(1);
    expect(result.recentWeeks[0]).toBe(3);
  });

  it("ne filtre pas par cutoffDate (LIMIT 12 suffit)", () => {
    seedUniformPool(2, 4);
    const cfgWithCutoff = { ...TEST_CONFIG, cutoffDate: "2020-01-01" };
    const cfgWithout = { ...TEST_CONFIG };
    const r1 = forecastMetric.compute(createTestContext(db, cfgWithCutoff));
    const r2 = forecastMetric.compute(createTestContext(db, cfgWithout));
    expect(r1.weeksUsed).toBe(r2.weeksUsed);
  });
});

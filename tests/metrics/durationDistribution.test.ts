import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { durationDistributionMetric } from "../../src/metrics/durationDistribution";
import { SECONDS_PER_DAY } from "../../src/metrics/utils";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

function seedCycle(key: string, devStartIso: string, doneIso: string, opts: { todo?: string | null; estimateSeconds?: number | null; issueType?: string } = {}) {
  const steps: Array<{ to: string; at: string }> = [];
  if (opts.todo !== null) {
    steps.push({ to: "To Do", at: opts.todo ?? "2025-01-06T09:00:00Z" });
  }
  steps.push({ to: "In Progress", at: devStartIso });
  steps.push({ to: "Done", at: doneIso });
  seedIssueWithTransitions(
    db,
    makeIssue({
      key,
      issueType: opts.issueType ?? "Story",
      originalEstimateSeconds: opts.estimateSeconds ?? null,
    }),
    steps
  );
}

describe("durationDistributionMetric.compute", () => {
  it("retourne séries vides sans données", () => {
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(0);
    expect(result.cycle.global.bins).toEqual([]);
    expect(result.cycle.global.kde).toEqual([]);
    expect(result.cycle.global.hasKde).toBe(false);
    expect(Object.keys(result.cycle.byBucket)).toHaveLength(0);
    expect(result.lead.global.count).toBe(0);
  });

  it("count=1 → 1 bin, hasKde=false, CDF monotone à 1", () => {
    seedCycle("PROJ-1", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z");
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(1);
    expect(result.cycle.global.bins.length).toBeGreaterThanOrEqual(1);
    expect(result.cycle.global.hasKde).toBe(false);
    const totalBinned = result.cycle.global.bins.reduce((s, b) => s + b.count, 0);
    expect(totalBinned).toBe(1);
    expect(result.cycle.global.kde.length).toBe(50);
    expect(result.cycle.global.kde[49].cdf).toBeCloseTo(1, 6);
    for (const p of result.cycle.global.kde) {
      expect(p.density).toBe(0);
    }
  });

  it("count=10 σ>0 → hasKde=true, kde.length=50, density>0, CDF monotone 0→1", () => {
    const cycleDays = [1, 2, 2, 3, 3, 4, 4, 5, 6, 8];
    cycleDays.forEach((d, i) => {
      const start = new Date("2025-01-06T09:00:00Z");
      const done = new Date(start.getTime());
      done.setUTCDate(start.getUTCDate() + d + 2);
      seedCycle(`PROJ-${i + 1}`, start.toISOString(), done.toISOString());
    });
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(10);
    expect(result.cycle.global.hasKde).toBe(true);
    expect(result.cycle.global.kde.length).toBe(50);
    const positiveDensities = result.cycle.global.kde.filter((p) => p.density > 0);
    expect(positiveDensities.length).toBeGreaterThan(0);
    for (let i = 1; i < result.cycle.global.kde.length; i++) {
      expect(result.cycle.global.kde[i].cdf).toBeGreaterThanOrEqual(result.cycle.global.kde[i - 1].cdf);
    }
    expect(result.cycle.global.kde[49].cdf).toBeCloseTo(1, 6);
  });

  it("BUG et UNESTIMATED inclus dans global mais absents de byBucket", () => {
    seedCycle("BUG-1", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z", { issueType: "Bug", estimateSeconds: SECONDS_PER_DAY * 2 });
    seedCycle("PROJ-1", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z", { estimateSeconds: null });
    seedCycle("PROJ-2", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z", { estimateSeconds: SECONDS_PER_DAY * 5 });
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(3);
    expect(result.cycle.byBucket.BUG).toBeUndefined();
    expect(result.cycle.byBucket.UNESTIMATED).toBeUndefined();
    expect(result.cycle.byBucket.XL).toBeDefined();
    expect(result.cycle.byBucket.XL!.count).toBe(1);
  });

  it("σ=0 (valeurs identiques) → hasKde=false même si n≥4", () => {
    for (let i = 1; i <= 4; i++) {
      seedCycle(`PROJ-${i}`, "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z");
    }
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(4);
    expect(result.cycle.global.hasKde).toBe(false);
    for (const p of result.cycle.global.kde) {
      expect(p.density).toBe(0);
    }
    expect(result.cycle.global.kde[49].cdf).toBeCloseTo(1, 6);
  });

  it("n=2 et n=3 → hasKde=false (frontière n<4)", () => {
    seedCycle("PROJ-1", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z");
    seedCycle("PROJ-2", "2025-01-08T09:00:00Z", "2025-01-13T09:00:00Z");
    const r2 = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(r2.cycle.global.count).toBe(2);
    expect(r2.cycle.global.hasKde).toBe(false);

    seedCycle("PROJ-3", "2025-01-08T09:00:00Z", "2025-01-14T09:00:00Z");
    const r3 = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(r3.cycle.global.count).toBe(3);
    expect(r3.cycle.global.hasKde).toBe(false);
  });

  it("max=0 (startedAt=doneAt) → 1 bin [0,0], CDF marche à 1, hasKde=false", () => {
    seedCycle("PROJ-1", "2025-01-08T09:00:00Z", "2025-01-08T09:00:00Z");
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(1);
    expect(result.cycle.global.max).toBe(0);
    expect(result.cycle.global.bins).toEqual([{ start: 0, end: 0, count: 1 }]);
    expect(result.cycle.global.hasKde).toBe(false);
    expect(result.cycle.global.kde.length).toBe(50);
    for (const p of result.cycle.global.kde) {
      expect(p.density).toBe(0);
      expect(p.cdf).toBeCloseTo(1, 6);
    }
  });

  it("lead-time exclut issues sans transition TODO ; cycle-time les conserve", () => {
    seedCycle("PROJ-1", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z", { todo: "2025-01-06T09:00:00Z" });
    seedCycle("PROJ-2", "2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z", { todo: null });
    const result = durationDistributionMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.cycle.global.count).toBe(2);
    expect(result.lead.global.count).toBe(1);
  });
});

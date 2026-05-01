import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { generateWeekEndings, extractStats, backfillSnapshots } from "../../src/snapshots/compute";
import type Database from "better-sqlite3";
import type { DurationStats } from "../../src/metrics/utils";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// ─── generateWeekEndings ─────────────────────────────────────────────────────

describe("generateWeekEndings", () => {
  it("premier résultat est un dimanche >= cutoff", () => {
    const dates = generateWeekEndings("2025-01-06"); // lundi
    expect(dates.length).toBeGreaterThan(0);
    const first = new Date(dates[0] + "T00:00:00Z");
    expect(first.getUTCDay()).toBe(0); // 0 = dimanche
    expect(first >= new Date("2025-01-06T00:00:00Z")).toBe(true);
  });

  it("quand cutoff est déjà un dimanche, ce dimanche est la 1ère date", () => {
    const dates = generateWeekEndings("2025-01-05"); // dimanche 5 jan 2025
    expect(dates[0]).toBe("2025-01-05");
  });

  it("écart exactement 7 jours entre dates consécutives", () => {
    const dates = generateWeekEndings("2025-01-05");
    for (let i = 1; i < Math.min(dates.length, 5); i++) {
      const prev = new Date(dates[i - 1] + "T00:00:00Z").getTime();
      const curr = new Date(dates[i] + "T00:00:00Z").getTime();
      expect(curr - prev).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it("dernière date <= aujourd'hui", () => {
    const dates = generateWeekEndings("2025-01-05");
    const last = new Date(dates[dates.length - 1] + "T00:00:00Z");
    expect(last <= new Date()).toBe(true);
  });

  it("cutoff futur → tableau vide", () => {
    const dates = generateWeekEndings("2099-01-01");
    expect(dates).toHaveLength(0);
  });
});

// ─── extractStats ─────────────────────────────────────────────────────────────

describe("extractStats (shape avgDays — cycle-time / lead-time)", () => {
  const durationStats: DurationStats = {
    count: 5,
    excludedOutliers: 0,
    avgDays: 3,
    medianDays: 2.5,
    p85Days: 5,
    p95Days: 6,
  };

  it("produit count, median, p85", () => {
    const rows = extractStats("2025-01-05", "cycle-time", { ...durationStats, issues: [] });
    const stats = rows.map((r) => r.stat);
    expect(stats).toContain("count");
    expect(stats).toContain("median");
    expect(stats).toContain("p85");
  });

  it("valeurs correctes", () => {
    const rows = extractStats("2025-01-05", "cycle-time", { ...durationStats, issues: [] });
    const byKey = Object.fromEntries(rows.map((r) => [r.stat, r.value]));
    expect(byKey.count).toBe(5);
    expect(byKey.median).toBe(2.5);
    expect(byKey.p85).toBe(5);
  });

  it("count=0 → aucune ligne (ou toutes à 0 selon résultat)", () => {
    const emptyStats: DurationStats = { count: 0, excludedOutliers: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0 };
    const rows = extractStats("2025-01-05", "cycle-time", { ...emptyStats, issues: [] });
    // count=0 → count row value = 0
    const countRow = rows.find((r) => r.stat === "count");
    expect(countRow?.value).toBe(0);
  });

  it("snapshot_date et metric_name sont correctement propagés", () => {
    const rows = extractStats("2025-01-19", "lead-time", { ...durationStats, issues: [] });
    rows.forEach((r) => {
      expect(r.snapshot_date).toBe("2025-01-19");
      expect(r.metric_name).toBe("lead-time");
    });
  });
});

describe("extractStats (shape byWeek — throughput)", () => {
  it("count = somme de tous les counts hebdomadaires", () => {
    const result = { byWeek: [{ week: "2025-W01", count: 3 }, { week: "2025-W02", count: 5 }], avgPerWeek: 4 };
    const rows = extractStats("2025-01-19", "throughput", result as unknown as Record<string, unknown>);
    const countRow = rows.find((r) => r.stat === "count");
    expect(countRow?.value).toBe(8);
  });

  it("pas de ligne estimatedDays pour le throughput simple", () => {
    const result = { byWeek: [{ week: "2025-W01", count: 3 }], avgPerWeek: 3 };
    const rows = extractStats("2025-01-19", "throughput", result as unknown as Record<string, unknown>);
    expect(rows.find((r) => r.stat === "estimatedDays")).toBeUndefined();
  });

  it("produit estimatedDays pour throughput-weighted", () => {
    const result = {
      byWeek: [{ week: "2025-W01", estimatedDays: 4.5, estimatedCount: 3, unestimatedCount: 1 }],
      avgPerWeek: 4.5,
    };
    const rows = extractStats("2025-01-19", "throughput-weighted", result as unknown as Record<string, unknown>);
    const edRow = rows.find((r) => r.stat === "estimatedDays");
    expect(edRow).toBeDefined();
    expect(edRow?.value).toBeCloseTo(4.5, 5);
  });
});

describe("extractStats (shape buckets — by-size)", () => {
  const durationStats: DurationStats = { count: 2, excludedOutliers: 0, avgDays: 3, medianDays: 3, p85Days: 4, p95Days: 5 };

  it("produit count, median, p85, p95 par bucket non vide", () => {
    const result = { buckets: { M: durationStats } };
    const rows = extractStats("2025-01-19", "cycle-time-by-size", result as unknown as Record<string, unknown>);
    const stats = rows.map((r) => r.stat);
    expect(stats).toContain("count");
    expect(stats).toContain("median");
    expect(stats).toContain("p85");
    expect(stats).toContain("p95");
  });

  it("valeur p95 correcte", () => {
    const result = { buckets: { M: durationStats } };
    const rows = extractStats("2025-01-19", "lead-time-by-size", result as unknown as Record<string, unknown>);
    const p95Row = rows.find((r) => r.stat === "p95" && r.bucket === "M");
    expect(p95Row?.value).toBe(5);
  });

  it("bucket avec count=0 → aucune ligne pour ce bucket", () => {
    const emptyBucket: DurationStats = { count: 0, excludedOutliers: 0, avgDays: 0, medianDays: 0, p85Days: 0, p95Days: 0 };
    const result = { buckets: { M: durationStats, XL: emptyBucket } };
    const rows = extractStats("2025-01-19", "cycle-time-by-size", result as unknown as Record<string, unknown>);
    const xlRows = rows.filter((r) => r.bucket === "XL");
    expect(xlRows).toHaveLength(0);
  });

  it("bucket correct dans les lignes produites", () => {
    const result = { buckets: { S: durationStats } };
    const rows = extractStats("2025-01-19", "cycle-time-by-size", result as unknown as Record<string, unknown>);
    rows.forEach((r) => expect(r.bucket).toBe("S"));
  });
});

describe("extractStats (shape riskCounts — aging-wip)", () => {
  const agingResult = {
    count: 3,
    percentiles: { p50: 4, p85: 7, p95: 10 },
    riskCounts: { ok: 1, watch: 1, atRisk: 0, critical: 1 },
    issues: [],
    asOf: "2025-01-19",
    unit: "j",
  };

  it("produit count, ok, watch, atRisk, critical, p50, p85, p95", () => {
    const rows = extractStats("2025-01-19", "aging-wip", agingResult as unknown as Record<string, unknown>);
    const stats = rows.map((r) => r.stat);
    expect(stats).toContain("count");
    expect(stats).toContain("ok");
    expect(stats).toContain("watch");
    expect(stats).toContain("atRisk");
    expect(stats).toContain("critical");
    expect(stats).toContain("p50");
    expect(stats).toContain("p85");
    expect(stats).toContain("p95");
  });

  it("valeurs correctes", () => {
    const rows = extractStats("2025-01-19", "aging-wip", agingResult as unknown as Record<string, unknown>);
    const byKey = Object.fromEntries(rows.map((r) => [r.stat, r.value]));
    expect(byKey.count).toBe(3);
    expect(byKey.ok).toBe(1);
    expect(byKey.critical).toBe(1);
    expect(byKey.p85).toBe(7);
  });
});

describe("extractStats (shape aggregateFlowEfficiency — flow-efficiency)", () => {
  const feResult = {
    count: 5,
    excludedOutliers: 0,
    aggregateFlowEfficiency: 0.42,
    medianFlowEfficiency: 0.35,
    p15FlowEfficiency: 0.1,
    totalActiveDays: 10,
    totalQueueDays: 14,
    issues: [],
    unit: "ratio",
  };

  it("produit count, aggregate, median, activeDays, queueDays", () => {
    const rows = extractStats("2025-01-19", "flow-efficiency", feResult as unknown as Record<string, unknown>);
    const stats = rows.map((r) => r.stat);
    expect(stats).toContain("count");
    expect(stats).toContain("aggregate");
    expect(stats).toContain("median");
    expect(stats).toContain("activeDays");
    expect(stats).toContain("queueDays");
  });

  it("valeurs correctes", () => {
    const rows = extractStats("2025-01-19", "flow-efficiency", feResult as unknown as Record<string, unknown>);
    const byKey = Object.fromEntries(rows.map((r) => [r.stat, r.value]));
    expect(byKey.aggregate).toBeCloseTo(0.42, 5);
    expect(byKey.activeDays).toBe(10);
    expect(byKey.queueDays).toBe(14);
  });
});

// ─── backfillSnapshots (smoke test) ───────────────────────────────────────────

describe("backfillSnapshots", () => {
  it("retourne 0 si cutoffDate est dans le futur", () => {
    const count = backfillSnapshots(db, { ...TEST_CONFIG, cutoffDate: "2099-01-01" });
    expect(count).toBe(0);
  });

  it("supprime les snapshots existants avant d'insérer", () => {
    // Insère un faux snapshot
    db.exec(`INSERT INTO metric_snapshots (snapshot_date, metric_name, bucket, stat, value)
             VALUES ('2020-01-01', 'test', '', 'count', 99)`);
    backfillSnapshots(db, { ...TEST_CONFIG, cutoffDate: "2099-01-01" }); // no-op (futur)
    // Le DELETE est dans la transaction quoi qu'il arrive
    const count = (db.prepare("SELECT COUNT(*) AS c FROM metric_snapshots WHERE metric_name = 'test'").get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it("insère des lignes dans metric_snapshots pour les semaines passées", () => {
    // Seeder une issue pour que les métriques aient des données
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-10T09:00:00Z" },
    ]);
    // Cutoff proche : juste quelques semaines à traiter
    const weeksCount = backfillSnapshots(db, { ...TEST_CONFIG, cutoffDate: "2025-04-14" });
    expect(weeksCount).toBeGreaterThan(0);
    const rowCount = (db.prepare("SELECT COUNT(*) AS c FROM metric_snapshots").get() as { c: number }).c;
    expect(rowCount).toBeGreaterThan(0);
  });
});

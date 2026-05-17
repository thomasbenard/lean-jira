import { describe, it, expect, vi } from "vitest";
import { evalLowerBetter, evalHigherBetter, computeDynamicThresholds, resolveThresholds } from "../../src/report/generate";
import type { SnapshotRow } from "../../src/snapshots/compute";

describe("evalLowerBetter", () => {
  const t = { warn: 5, crit: 10 };

  it("retourne vert si valeur dans la zone saine", () => {
    expect(evalLowerBetter(3, t)).toBe("green");
  });

  it("retourne orange si valeur en zone orange", () => {
    expect(evalLowerBetter(7, t)).toBe("orange");
  });

  it("retourne rouge si valeur en zone rouge", () => {
    expect(evalLowerBetter(12, t)).toBe("red");
  });

  it("retourne vert si valeur exactement au seuil warn (inclusif)", () => {
    expect(evalLowerBetter(5, t)).toBe("green");
  });

  it("retourne none si seuil absent", () => {
    expect(evalLowerBetter(12, undefined)).toBe("none");
  });

  it("retourne none si valeur null même si seuil présent", () => {
    expect(evalLowerBetter(null, t)).toBe("none");
  });
});

describe("evalHigherBetter", () => {
  const t = { warn: 3, crit: 1 };

  it("retourne vert si throughput élevé", () => {
    expect(evalHigherBetter(5, t)).toBe("green");
  });

  it("retourne orange si throughput faible", () => {
    expect(evalHigherBetter(2, t)).toBe("orange");
  });

  it("retourne rouge si throughput nul", () => {
    expect(evalHigherBetter(0, t)).toBe("red");
  });

  it("retourne vert si valeur exactement au seuil warn (inclusif)", () => {
    expect(evalHigherBetter(3, t)).toBe("green");
  });

  it("retourne orange si valeur exactement au seuil crit (inclusif)", () => {
    expect(evalHigherBetter(1, t)).toBe("orange");
  });

  it("retourne none si valeur null même si seuil présent", () => {
    expect(evalHigherBetter(null, t)).toBe("none");
  });

  it("retourne none si seuil absent", () => {
    expect(evalHigherBetter(5, undefined)).toBe("none");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function makeRows(metric: string, bucket: string, stat: string, values: number[], windowWeeks = 12): SnapshotRow[] {
  const windowDays = windowWeeks * 7;
  return values.map((value, i) => ({
    snapshot_date: dateAgo(windowDays - 10 - i * Math.floor((windowDays - 20) / values.length)),
    metric_name: metric,
    bucket,
    stat,
    value,
  }));
}

// ─── computeDynamicThresholds ─────────────────────────────────────────────────

describe("computeDynamicThresholds", () => {
  it("calcule P50 et P85 pour métrique lower-better (lead-time)", () => {
    // 12 valeurs [1..12] → P50=ceil(0.5*12)-1=5→6, P85=ceil(0.85*12)-1=10→11
    const rows = makeRows("lead-time", "", "median", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const result = computeDynamicThresholds(rows, 12);
    expect(result.leadTimeMedianDays).toEqual({ warn: 6, crit: 11 });
  });

  it("calcule P50 et P15 pour throughput (higher-better)", () => {
    // 12 valeurs [1..12] → P50=6, P15=idx1=2
    const rows = makeRows("throughput", "", "count", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const result = computeDynamicThresholds(rows, 12);
    expect(result.throughputWeekly).toEqual({ warn: 6, crit: 2 });
  });

  it("retourne undefined si moins de 4 valeurs dans la fenêtre", () => {
    const rows = makeRows("cycle-time", "", "median", [5, 6, 7]);
    const result = computeDynamicThresholds(rows, 12);
    expect(result.cycleTimeMedianDays).toBeUndefined();
  });

  it("exclut les snapshots hors fenêtre (trop anciens)", () => {
    const windowWeeks = 4;
    const inWindow = makeRows("cycle-time", "", "median", [1, 2, 3, 4, 5], windowWeeks);
    const tooOld: SnapshotRow[] = [
      { snapshot_date: dateAgo(40), metric_name: "cycle-time", bucket: "", stat: "median", value: 100 },
      { snapshot_date: dateAgo(45), metric_name: "cycle-time", bucket: "", stat: "median", value: 200 },
    ];
    const result = computeDynamicThresholds([...inWindow, ...tooOld], windowWeeks);
    // les 2 valeurs hors fenêtre (100, 200) ne doivent pas influencer P85
    expect(result.cycleTimeMedianDays!.crit).toBeLessThan(50);
  });

  it("WIP daily : calcule P50/P85 sur snapshots quotidiens dans la fenêtre", () => {
    // pourquoi : WIP est snapshotté quotidiennement. computeDynamicThresholds doit
    // filtrer par date calendaire (et non par compte de slots) pour rester correct
    // peu importe la cadence (daily WIP, weekly autres KPIs).
    const windowDays = 12 * 7;
    const rows: SnapshotRow[] = [];
    for (let i = 0; i < windowDays - 1; i++) {
      const value = i + 1;
      rows.push({
        snapshot_date: dateAgo(windowDays - 1 - i),
        metric_name: "wip",
        bucket: "",
        stat: "count",
        value,
      });
    }
    // valeurs trop anciennes ne doivent pas être prises en compte
    rows.push({ snapshot_date: dateAgo(200), metric_name: "wip", bucket: "", stat: "count", value: 9999 });
    const result = computeDynamicThresholds(rows, 12);
    expect(result.wipCount).toBeDefined();
    // P50 d'une suite 1..83 ≈ 42 ; aucune influence de la valeur 9999 hors fenêtre
    expect(result.wipCount!.warn).toBeGreaterThan(30);
    expect(result.wipCount!.warn).toBeLessThan(60);
    expect(result.wipCount!.crit).toBeLessThan(100);
  });

  it("couvre tous les KPIs supportés (bug-cycle, wip, bugRatio)", () => {
    const rows = [
      ...makeRows("bug-cycle-time", "", "median", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      ...makeRows("wip", "", "count", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      ...makeRows("dev-time-allocation", "", "bugRatio", [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]),
    ];
    const result = computeDynamicThresholds(rows, 12);
    expect(result.bugCycleTimeMedianDays).toBeDefined();
    expect(result.wipCount).toBeDefined();
    expect(result.bugRatio).toBeDefined();
  });
});

// ─── resolveThresholds ────────────────────────────────────────────────────────

describe("resolveThresholds", () => {
  const cycleRows = makeRows("cycle-time", "", "median", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  it("mode static : retourne les ThresholdPair configurés tels quels", () => {
    const config = { mode: "static" as const, cycleTimeMedianDays: { warn: 10, crit: 20 } };
    const result = resolveThresholds(config, cycleRows);
    expect(result.cycleTimeMedianDays).toEqual({ warn: 10, crit: 20 });
  });

  it("mode absent : équivalent static (rétrocompatibilité)", () => {
    const config = { cycleTimeMedianDays: { warn: 10, crit: 20 } };
    const result = resolveThresholds(config, cycleRows);
    expect(result.cycleTimeMedianDays).toEqual({ warn: 10, crit: 20 });
  });

  it("config undefined : retourne objet vide", () => {
    expect(resolveThresholds(undefined, cycleRows)).toEqual({});
  });

  it("mode dynamic : utilise les seuils calculés", () => {
    const config = { mode: "dynamic" as const, windowWeeks: 12 };
    const result = resolveThresholds(config, cycleRows);
    expect(result.cycleTimeMedianDays).toEqual({ warn: 6, crit: 11 });
  });

  it("mode dynamic + override statique : override gagne pour ce KPI, dynamique pour les autres", () => {
    const allRows = [
      ...cycleRows,
      ...makeRows("lead-time", "", "median", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    ];
    const config = {
      mode: "dynamic" as const,
      windowWeeks: 12,
      cycleTimeMedianDays: { warn: 99, crit: 199 },
    };
    const result = resolveThresholds(config, allRows);
    expect(result.cycleTimeMedianDays).toEqual({ warn: 99, crit: 199 });
    expect(result.leadTimeMedianDays).toEqual({ warn: 6, crit: 11 });
  });

  it("mode inconnu : avertit et fallback static", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = { mode: "invalid" as "static", cycleTimeMedianDays: { warn: 5, crit: 10 } };
    const result = resolveThresholds(config, cycleRows);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid"));
    expect(result.cycleTimeMedianDays).toEqual({ warn: 5, crit: 10 });
    warn.mockRestore();
  });
});

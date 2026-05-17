import { describe, it, expect, beforeEach } from "vitest";
import { initLocale } from "../../src/i18n/index";
import {
  buildKpiCells,
  computeVerdict,
  buildTop3Actions,
  type KpiCell,
} from "../../src/report/generate";
import type { AgingWipSummary, AgingWipIssue } from "../../src/metrics/agingWip";

beforeEach(() => { initLocale("en"); });

const emptySeries = { dates: [], series: {} as Record<string, number[]> };

function weeklyDates(n: number, startISO = "2026-01-04"): string[] {
  const out: string[] = [];
  const start = new Date(startISO + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dailyDates(n: number, startISO = "2026-01-01"): string[] {
  const out: string[] = [];
  const start = new Date(startISO + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function makeChartsWithLeadHistory(history: number[]): Record<string, { dates: string[]; series: Record<string, number[]> }> {
  return {
    leadTime: { dates: weeklyDates(history.length), series: { median: history } },
    cycleTime: emptySeries,
    throughput: emptySeries,
    wip: emptySeries,
    bugCycleTime: emptySeries,
    devTimeAllocation: emptySeries,
    ftrByRole: emptySeries,
  };
}

function makeChartsWithWipDaily(history: number[]): Record<string, { dates: string[]; series: Record<string, number[]> }> {
  return {
    leadTime: emptySeries,
    cycleTime: emptySeries,
    throughput: emptySeries,
    wip: { dates: dailyDates(history.length), series: { count: history } },
    bugCycleTime: emptySeries,
    devTimeAllocation: emptySeries,
    ftrByRole: emptySeries,
  };
}

function makeAgingWip(overrides: Partial<AgingWipSummary> = {}): AgingWipSummary {
  return {
    asOf: "2026-01-01",
    count: 0,
    percentiles: { p50: 3, p85: 9, p95: 13 },
    riskCounts: { ok: 0, watch: 0, atRisk: 0, critical: 0 },
    issues: [],
    unit: "j",
    ...overrides,
  };
}

function makeIssue(key: string, ageDays: number, risk: AgingWipIssue["riskLevel"], status = "Dev in progress"): AgingWipIssue {
  return { issueKey: key, summary: `Story ${key}`, status, startedAt: "2025-12-01", ageDays, riskLevel: risk };
}

const NEUTRAL_SIGNALS = {
  leadTime: "none" as const,
  cycleTime: "none" as const,
  throughput: "none" as const,
  wip: "none" as const,
  bugCycle: "none" as const,
  bugRatio: "none" as const,
};

describe("buildKpiCells — delta 4 sem", () => {
  it("calcule delta = pct(curr, avg(history.slice(0,-1).slice(-4)))", () => {
    const charts = makeChartsWithLeadHistory([10, 10, 10, 10, 12]);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const lead = cells.find((c) => c.key === "lead");
    expect(lead).toBeDefined();
    expect(lead!.value).toBe(12);
    expect(lead!.delta4w).toBeCloseTo(20, 5);
  });

  it("retourne delta=null si historique a moins de 5 points", () => {
    const charts = makeChartsWithLeadHistory([10, 11, 12]);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const lead = cells.find((c) => c.key === "lead");
    expect(lead!.delta4w).toBeNull();
  });

  it("retourne delta=null si reference moyenne = 0 (évite division par zéro)", () => {
    const charts = makeChartsWithLeadHistory([0, 0, 0, 0, 5]);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const lead = cells.find((c) => c.key === "lead");
    expect(lead!.delta4w).toBeNull();
  });

  it("propage le signal santé fourni en argument", () => {
    const charts = makeChartsWithLeadHistory([10, 10, 10, 10, 14]);
    const cells = buildKpiCells(charts, makeAgingWip(), { ...NEUTRAL_SIGNALS, leadTime: "red" });
    const lead = cells.find((c) => c.key === "lead");
    expect(lead!.signal).toBe("red");
  });

  it("WIP daily : delta = pct(curr, value 28 jours avant) — pas moyenne des 4 derniers jours", () => {
    // pourquoi : WIP est snapshotté quotidiennement (point-in-time). Le delta 4w
    // doit comparer la valeur actuelle à la valeur d'il y a ~28 jours, pas à la
    // moyenne des 4 derniers points (= 4 derniers jours = bruit).
    // Construction : day0=5 (ref attendue), days 1..24 = 5, days 25..28 = 20
    // (les 4 valeurs avant la dernière), day29 = 10.
    // Date-based : ref = day1 = 5 → delta = (10-5)/5*100 = +100 (cadence 1j → target = day29-28 = day1)
    // Slot-based legacy : ref = avg([20,20,20,20]) = 20 → delta = -50
    const history = [
      ...Array(25).fill(5),     // day0..day24
      20, 20, 20, 20,            // day25..day28
      10,                        // day29 (last)
    ];
    const charts = makeChartsWithWipDaily(history);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const wip = cells.find((c) => c.key === "wip");
    expect(wip!.value).toBe(10);
    expect(wip!.delta4w).toBeCloseTo(100, 5);
  });

  it("WIP daily : historique insuffisant (< 29 jours) → delta=null", () => {
    // 20 jours d'historique : pas de date ≤ last-28d
    const history = Array.from({ length: 20 }, () => 5);
    history[history.length - 1] = 10;
    const charts = makeChartsWithWipDaily(history);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const wip = cells.find((c) => c.key === "wip");
    expect(wip!.delta4w).toBeNull();
  });

  it("WIP daily : valeur de référence (J-28) = 0 → delta=null", () => {
    // dates[0]=2026-01-01 ... dates[29]=2026-01-30, last - 28d = 2026-01-02 = dates[1].
    // Donc on met 0 à dates[1] (la ref) ; le reste à 10.
    const history = Array(30).fill(10);
    history[1] = 0;
    const charts = makeChartsWithWipDaily(history);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const wip = cells.find((c) => c.key === "wip");
    expect(wip!.delta4w).toBeNull();
  });
});

describe("buildKpiCells — sparkline", () => {
  it("sparkline contient les 12 dernières valeurs", () => {
    const history = Array.from({ length: 20 }, (_, i) => i + 1);
    const charts = makeChartsWithLeadHistory(history);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const lead = cells.find((c) => c.key === "lead");
    expect(lead!.spark).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("sparkline peut être plus courte que 12 si historique insuffisant", () => {
    const charts = makeChartsWithLeadHistory([5, 6, 7]);
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const lead = cells.find((c) => c.key === "lead");
    expect(lead!.spark).toEqual([5, 6, 7]);
  });
});

describe("buildKpiCells — composition", () => {
  it("retourne exactement 8 cellules dans l'ordre attendu", () => {
    const charts = {
      leadTime: emptySeries,
      cycleTime: emptySeries,
      throughput: emptySeries,
      wip: emptySeries,
      bugCycleTime: emptySeries,
      devTimeAllocation: emptySeries,
      ftrByRole: emptySeries,
    };
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    expect(cells).toHaveLength(8);
    expect(cells.map((c) => c.key)).toEqual(["lead", "cycle", "throughput", "wip", "bugRatio", "bugCycle", "ftrDev", "criticalAging"]);
  });

  it("KPI critical aging compte les issues riskLevel=critical depuis agingWip", () => {
    const aging = makeAgingWip({
      issues: [
        makeIssue("K-1", 50, "critical"),
        makeIssue("K-2", 30, "critical"),
        makeIssue("K-3", 10, "at-risk"),
        makeIssue("K-4", 2, "ok"),
      ],
    });
    const charts = { leadTime: emptySeries, cycleTime: emptySeries, throughput: emptySeries, wip: emptySeries, bugCycleTime: emptySeries, devTimeAllocation: emptySeries, ftrByRole: emptySeries };
    const cells = buildKpiCells(charts, aging, NEUTRAL_SIGNALS);
    const aging4 = cells.find((c) => c.key === "criticalAging");
    expect(aging4!.value).toBe(2);
  });

  it("bugRatio est multiplié par 100 pour affichage en pourcent", () => {
    const charts = {
      leadTime: emptySeries,
      cycleTime: emptySeries,
      throughput: emptySeries,
      wip: emptySeries,
      bugCycleTime: emptySeries,
      devTimeAllocation: { dates: ["2026-01-01"], series: { bugRatio: [0.576] } },
      ftrByRole: emptySeries,
    };
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const bugRatio = cells.find((c) => c.key === "bugRatio");
    expect(bugRatio!.value).toBeCloseTo(57.6, 5);
    expect(bugRatio!.unit).toBe("%");
  });

  it("ftrDev est multiplié par 100 pour affichage en pourcent", () => {
    const charts = {
      leadTime: emptySeries,
      cycleTime: emptySeries,
      throughput: emptySeries,
      wip: emptySeries,
      bugCycleTime: emptySeries,
      devTimeAllocation: emptySeries,
      ftrByRole: { dates: ["2026-01-01"], series: { dev: [0.7] } },
    };
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const ftr = cells.find((c) => c.key === "ftrDev");
    expect(ftr!.value).toBe(70);
  });

  it("KPI throughput a direction higher (delta positif = good)", () => {
    const charts = {
      leadTime: emptySeries,
      cycleTime: emptySeries,
      throughput: { dates: [], series: { count: [10, 10, 10, 10, 15] } },
      wip: emptySeries,
      bugCycleTime: emptySeries,
      devTimeAllocation: emptySeries,
      ftrByRole: emptySeries,
    };
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    const thr = cells.find((c) => c.key === "throughput");
    expect(thr!.direction).toBe("higher");
  });

  it("KPI lead/cycle/wip/bugRatio/bugCycle ont direction lower", () => {
    const charts = { leadTime: emptySeries, cycleTime: emptySeries, throughput: emptySeries, wip: emptySeries, bugCycleTime: emptySeries, devTimeAllocation: emptySeries, ftrByRole: emptySeries };
    const cells = buildKpiCells(charts, makeAgingWip(), NEUTRAL_SIGNALS);
    for (const k of ["lead", "cycle", "wip", "bugRatio", "bugCycle"]) {
      const c = cells.find((x) => x.key === k);
      expect(c!.direction, `KPI ${k}`).toBe("lower");
    }
  });
});

describe("computeVerdict", () => {
  function cell(key: string, signal: KpiCell["signal"], value: number | null = 10): KpiCell {
    return { key, label: key, value, unit: "", signal, spark: [], delta4w: null, direction: "lower" };
  }

  it("status alert si au moins une cellule signal=red", () => {
    const cells = [cell("lead", "red", 14), cell("cycle", "green"), cell("wip", "orange", 25)];
    const v = computeVerdict(cells);
    expect(v.status).toBe("alert");
  });

  it("status watch si aucun red mais ≥1 orange", () => {
    const cells = [cell("lead", "orange"), cell("cycle", "green")];
    const v = computeVerdict(cells);
    expect(v.status).toBe("watch");
  });

  it("status ok si tous green ou none", () => {
    const cells = [cell("lead", "green"), cell("cycle", "none"), cell("wip", "green")];
    const v = computeVerdict(cells);
    expect(v.status).toBe("ok");
  });

  it("phrase mentionne les KPIs en signal red avec leur valeur formatée", () => {
    const cells = [cell("lead", "red", 13.8), cell("wip", "red", 30), cell("throughput", "green")];
    const v = computeVerdict(cells);
    expect(v.phrase).toContain("13.8");
    expect(v.phrase).toContain("30");
  });

  it("phrase positive si statut ok", () => {
    const cells = [cell("lead", "green"), cell("cycle", "green")];
    const v = computeVerdict(cells);
    expect(v.phrase).toMatch(/green zone|healthy|all/i);
  });

  it("liste maximum 3 KPIs dans la phrase pour rester scannable", () => {
    const cells = [
      cell("lead", "red", 14),
      cell("cycle", "red", 5),
      cell("wip", "red", 30),
      cell("bugRatio", "red", 60),
      cell("bugCycle", "red", 4),
    ];
    const v = computeVerdict(cells);
    const matches = v.phrase.match(/<strong>/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(3);
  });
});

describe("buildTop3Actions", () => {
  const BASE = "https://jira.example.com";

  it("liste les 3 critical les plus anciens triés par ageDays décroissant", () => {
    const aging = makeAgingWip({
      issues: [
        makeIssue("K-1", 30, "critical"),
        makeIssue("K-2", 72, "critical"),
        makeIssue("K-3", 64, "critical"),
        makeIssue("K-4", 20, "critical"),
        makeIssue("K-5", 19, "critical"),
      ],
    });
    const html = buildTop3Actions(aging, BASE);
    expect(html.indexOf("K-2")).toBeGreaterThan(-1);
    expect(html.indexOf("K-3")).toBeGreaterThan(-1);
    expect(html.indexOf("K-1")).toBeGreaterThan(-1);
    expect(html).not.toContain("K-4");
    expect(html).not.toContain("K-5");
    // ordre
    expect(html.indexOf("K-2")).toBeLessThan(html.indexOf("K-3"));
    expect(html.indexOf("K-3")).toBeLessThan(html.indexOf("K-1"));
  });

  it("complète avec at-risk si moins de 3 critical", () => {
    const aging = makeAgingWip({
      issues: [
        makeIssue("K-1", 30, "critical"),
        makeIssue("K-2", 12, "at-risk"),
        makeIssue("K-3", 11, "at-risk"),
        makeIssue("K-4", 10, "at-risk"),
        makeIssue("K-5", 5, "watch"),
      ],
    });
    const html = buildTop3Actions(aging, BASE);
    expect(html).toContain("K-1");
    expect(html).toContain("K-2");
    expect(html).toContain("K-3");
    expect(html).not.toContain("K-4");
    expect(html).not.toContain("K-5");
  });

  it("retourne carte verte unique si aucun critical ni at-risk", () => {
    const aging = makeAgingWip({
      issues: [makeIssue("K-1", 5, "watch"), makeIssue("K-2", 1, "ok")],
    });
    const html = buildTop3Actions(aging, BASE);
    expect(html).toContain("No tickets in critical zone");
    expect(html).not.toContain("K-1");
  });

  it("génère un lien Jira target=_blank pour chaque carte", () => {
    const aging = makeAgingWip({ issues: [makeIssue("K-1", 30, "critical")] });
    const html = buildTop3Actions(aging, BASE);
    expect(html).toContain(`href="${BASE}/browse/K-1"`);
    expect(html).toContain(`target="_blank"`);
    expect(html).toContain(`rel="noopener"`);
  });

  it("affiche le statut et l'âge dans le détail de chaque carte", () => {
    const aging = makeAgingWip({
      issues: [makeIssue("K-1", 72.9, "critical", "Stand By")],
    });
    const html = buildTop3Actions(aging, BASE);
    expect(html).toContain("Stand By");
    expect(html).toContain("72.9");
  });
});

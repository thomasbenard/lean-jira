import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { issueLink, agingRowsHtml, buildBucketSeries, buildRoleSeries, syncMetaLabel, staleBannerHtml, computeMovingAvg, renderWithHandlebars, isScopeChangeAvailable, buildScopeAlertBanner, buildScopeChangeChart, buildScopeSection, estimationFlags, buildSprintSeries } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import type { AgingWipSummary } from "../../src/metrics/agingWip";
import type { SnapshotRow } from "../../src/snapshots/compute";
import type { ScopeChangeResult, SprintScopeStats } from "../../src/metrics/scopeChange";
import type { EstimationConfig } from "../../src/metrics/types";
import { createTestDb } from "../helpers/db";
import { SqliteStore } from "../../src/store/sqlite";
import { upsertIssues, upsertSprints } from "../../src/db/store";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";

beforeEach(() => { initLocale("en"); });

type RenderInput = Parameters<typeof renderWithHandlebars>[0];

function renderDefault(input: RenderInput): string {
  const templatePath = path.join(__dirname, "../../src/report/templates/report.hbs");
  return renderWithHandlebars(input, templatePath);
}

function makeRenderInput(): RenderInput {
  const empty = { dates: [], series: {} };
  return {
    projectKey: "TEST",
    jiraBaseUrl: "https://test.atlassian.net",
    generatedAt: "2025-01-01 00:00:00",
    lastSnapshotDate: "2025-01-01",
    lastSyncAt: null,
    isSyncStale: false,
    kpis: {
      leadTimeMedian: null,
      cycleTimeMedian: null,
      throughputCount: null,
      wipCount: null,
      bugThroughputCount: null,
      bugCycleTimeMedian: null,
      flowEfficiencyAggregate: null,
      devTimeAvgBugRatio: null,
      stageTimeDevMedian: null,
      stageTimeQaMedian: null,
      stageTimePoMedian: null,
      wipDev: null,
      wipQa: null,
      wipPo: null,
      reworkRatio: null,
      avgReworks: null,
      ftrDev: null,
      ftrQa: null,
      ftrPo: null,
    },
    charts: {
      leadTime: empty,
      cycleTime: empty,
      throughput: empty,
      throughputWeighted: empty,
      wip: empty,
      bugThroughput: empty,
      bugCycleTime: empty,
      leadTimeNormalized: empty,
      cycleTimeNormalized: empty,
      flowEfficiency: empty,
      agingWipRisk: empty,
      devTimeAllocation: empty,
      bugBacklog: empty,
      stageTimeByRole: empty,
      stageTimeByRoleP85: empty,
      stageTimeShare: empty,
      wipPerRole: empty,
      stageThroughputNet: empty,
      handoffReworkRatio: empty,
      handoffReworkByType: empty,
      ftrByRole: empty,
      bottleneckScores: empty,
    },
    leadBySize: {},
    cycleBySize: {},
    leadTimeBySizeCharts: {},
    cycleTimeBySizeCharts: {},
    agingWip: {
      asOf: "2025-01-01",
      count: 0,
      percentiles: { p50: 0, p85: 0, p95: 0 },
      riskCounts: { ok: 0, watch: 0, atRisk: 0, critical: 0 },
      issues: [],
      unit: "j",
    },
    forecast: {
      recentWeeks: [],
      weeksUsed: 0,
      byHorizon: [],
      simulations: 0,
      unit: "issues",
    },
    histogram: [],
    cycleStats: { median: 0, p85: 0, p95: 0, avg: 0, count: 0 },
    bottleneck: {
      count: 0, primaryBottleneck: null, primaryColumn: null, recommendation: "",
      byRole: {
        dev: { score: 0, rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        qa:  { score: 0, rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        po:  { score: 0, rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
      },
      byColumn: [],
    },
    sprintCharts: null,
  };
}

function makeInput(estimation?: EstimationConfig): RenderInput {
  return { ...makeRenderInput(), estimation };
}

function isHidden(html: string, title: string): boolean {
  return new RegExp(`class="chart-card" style="display:none"[^>]*>\\s*<h3>(?:<span[^>]*>)?${title}`).test(html);
}
function isVisible(html: string, title: string): boolean {
  return new RegExp(`class="chart-card">\\s*<h3>(?:<span[^>]*>)?${title}`).test(html);
}

describe("issueLink", () => {
  it("génère un lien <a> vers la page Jira de l'issue", () => {
    const html = issueLink("KECK-123", "https://example.atlassian.net");
    expect(html).toBe(
      `<a href="https://example.atlassian.net/browse/KECK-123" target="_blank" rel="noopener">KECK-123</a>`,
    );
  });

  it("normalise un baseUrl avec slash final pour éviter //browse", () => {
    const html = issueLink("KECK-1", "https://example.atlassian.net/");
    expect(html).toContain(`href="https://example.atlassian.net/browse/KECK-1"`);
    expect(html).not.toContain("//browse");
  });

  it("retourne le texte brut échappé si la clé est vide", () => {
    expect(issueLink("", "https://example.atlassian.net")).toBe("");
  });

  it("échappe les caractères HTML d'une clé malformée pour éviter l'injection", () => {
    const html = issueLink('K<EY"', "https://example.atlassian.net");
    expect(html).toContain("K&lt;EY&quot;");
    expect(html).not.toContain("<EY");
  });

  it("échappe les caractères HTML dans le baseUrl", () => {
    const html = issueLink("K-1", 'https://x"y.com');
    expect(html).toContain("https://x&quot;y.com/browse/K-1");
  });
});

describe("buildBucketSeries", () => {
  const rows: SnapshotRow[] = [
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "median", value: 3 },
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "p85", value: 5 },
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "p95", value: 7 },
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "XS", stat: "median", value: 1 },
    { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "median", value: 4 },
    { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "p85", value: 6 },
    { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "p95", value: 8 },
  ];

  it("filtre par bucket et retourne les dates triées", () => {
    const result = buildBucketSeries(rows, "M", ["median", "p85", "p95"]);
    expect(result.dates).toEqual(["2025-01-05", "2025-01-12"]);
  });

  it("exclut les données d'autres buckets", () => {
    const result = buildBucketSeries(rows, "M", ["median"]);
    expect(result.dates).toHaveLength(2);
    // XS ne doit pas apparaître
    const xsResult = buildBucketSeries(rows, "XS", ["median"]);
    expect(xsResult.dates).toHaveLength(1);
    expect(xsResult.series.median).toEqual([1]);
  });

  it("retourne les séries correctes pour chaque stat", () => {
    const result = buildBucketSeries(rows, "M", ["median", "p85", "p95"]);
    expect(result.series.median).toEqual([3, 4]);
    expect(result.series.p85).toEqual([5, 6]);
    expect(result.series.p95).toEqual([7, 8]);
  });

  it("bucket sans données → dates vide", () => {
    const result = buildBucketSeries(rows, "XL", ["median", "p85", "p95"]);
    expect(result.dates).toHaveLength(0);
  });

  it("inclut la stat count quand demandée (pour sélection bucket par défaut)", () => {
    const withCount: SnapshotRow[] = [
      ...rows,
      { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "count", value: 10 },
      { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "count", value: 15 },
    ];
    const result = buildBucketSeries(withCount, "M", ["median", "p85", "p95", "count"]);
    expect(result.series.count).toEqual([10, 15]);
  });
});

describe("syncMetaLabel", () => {
  it("retourne le texte jamais synchronisé si null", () => {
    expect(syncMetaLabel(null)).toBe("Jira data: never synced");
  });

  it("affiche la date tronquée au format YYYY-MM-DD HH:MM", () => {
    expect(syncMetaLabel("2026-04-28T10:30:00Z")).toBe("Jira data: 2026-04-28 10:30");
  });

  it("fonctionne avec un timestamp ISO sans milliseconde", () => {
    expect(syncMetaLabel("2026-01-15T08:05:00.000Z")).toBe("Jira data: 2026-01-15 08:05");
  });
});

describe("staleBannerHtml", () => {
  it("retourne chaîne vide si isSyncStale = false", () => {
    expect(staleBannerHtml(false, "2026-04-28T10:30:00Z")).toBe("");
  });

  it("retourne le bandeau si isSyncStale = true avec lastSyncAt", () => {
    const html = staleBannerHtml(true, "2026-04-22T10:30:00Z");
    expect(html).toContain("stale-warning");
    expect(html).toContain("2026-04-22");
    expect(html).toContain("npm run sync");
  });

  it("retourne le bandeau avec 'jamais effectué' si lastSyncAt = null", () => {
    const html = staleBannerHtml(true, null);
    expect(html).toContain("stale-warning");
    expect(html).toContain("never synced");
  });

  it("le bandeau est non vide si stale + lastSyncAt présent", () => {
    expect(staleBannerHtml(true, "2026-04-20T00:00:00Z")).not.toBe("");
  });
});

describe("agingRowsHtml", () => {
  const BASE = "https://example.atlassian.net";

  const summary = (issues: AgingWipSummary["issues"]): AgingWipSummary => ({
    asOf: "2025-02-03",
    count: issues.length,
    percentiles: { p50: 1, p85: 3, p95: 5 },
    riskCounts: { ok: 0, watch: 0, atRisk: 0, critical: 0 },
    issues,
    unit: "j",
  });

  it("rend la cellule Issue avec un lien <a> cliquable vers Jira", () => {
    const html = agingRowsHtml(
      summary([
        { issueKey: "KECK-42", summary: "x", status: "En cours", startedAt: "2025-02-01", ageDays: 2, riskLevel: "watch" },
      ]),
      BASE,
    );
    expect(html).toContain(`<a href="${BASE}/browse/KECK-42" target="_blank" rel="noopener">KECK-42</a>`);
  });

  it("affiche le message vide si aucune issue", () => {
    const html = agingRowsHtml(summary([]), BASE);
    expect(html).toContain("No items in progress");
    expect(html).not.toContain("<a href");
  });
});

describe("computeMovingAvg", () => {
  it("série vide retourne tableau vide", () => {
    expect(computeMovingAvg([])).toEqual([]);
  });

  it("n < window : tous les points retournent null", () => {
    expect(computeMovingAvg([1, 2, 3])).toEqual([null, null, null]);
  });

  it("n = window : premiers (window-1) null, dernier = moyenne", () => {
    expect(computeMovingAvg([1, 2, 3, 4])).toEqual([null, null, null, 2.5]);
  });

  it("n > window : moyenne glissante correcte sur chaque position", () => {
    expect(computeMovingAvg([1, 2, 3, 4, 5])).toEqual([null, null, null, 2.5, 3.5]);
  });

  it("série constante : tendance = valeur constante (pente zéro)", () => {
    expect(computeMovingAvg([10, 10, 10, 10, 10])).toEqual([null, null, null, 10, 10]);
  });

  it("arrondi à 2 décimales", () => {
    const result = computeMovingAvg([1, 1, 1, 1, 2]);
    expect(result[4]).toBe(1.25);
  });

  it("valeurs zéro incluses dans la fenêtre sans filtrage", () => {
    const result = computeMovingAvg([0, 0, 0, 4]);
    expect(result[3]).toBe(1);
  });

  it("window personnalisée de 2", () => {
    expect(computeMovingAvg([1, 3, 5, 7], 2)).toEqual([null, 2, 4, 6]);
  });
});

describe("renderDefault — template Handlebars embarqué", () => {
  it("contient class=verdict et class=kpi-grid avec le renderer par défaut", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).toContain('class="verdict');
    expect(html).toContain('class="kpi-grid"');
  });
});

describe("renderDefault — Cockpit structure", () => {
  it("contient le bandeau verdict, les actions top-3 et la grille KPI", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).toContain('class="verdict');
    expect(html).toContain('class="actions-grid"');
    expect(html).toContain('class="kpi-grid"');
  });

  it("contient les 5 onglets dans l'ordre Livraison → Qualité → Rôles → Forecast → Avancé", () => {
    const html = renderDefault(makeRenderInput());
    const order = ["delivery", "quality", "roles", "forecast", "advanced"];
    let prev = -1;
    for (const id of order) {
      const pos = html.indexOf(`data-tab="${id}"`);
      expect(pos, `tab ${id}`).toBeGreaterThan(prev);
      prev = pos;
    }
  });

  it("onglet Livraison actif par défaut", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).toContain('class="tab active" data-tab="delivery"');
    expect(html).toContain('class="tab-panel active" id="tab-delivery"');
  });

  it("panel Livraison contient lead/cycle/throughput/throughputWeighted/wip/cycleHistogram et by-size tables", () => {
    const html = renderDefault(makeRenderInput());
    const start = html.indexOf('id="tab-delivery"');
    const end = html.indexOf('id="tab-quality"');
    const panel = html.slice(start, end);
    for (const id of ["leadTimeChart", "cycleTimeChart", "throughputChart", "throughputWeightedChart", "wipChart", "cycleHistogramChart"]) {
      expect(panel, `canvas ${id}`).toContain(`id="${id}"`);
    }
    expect(panel).toContain("Lead time by size");
  });

  it("panel Qualité contient les charts bugs", () => {
    const html = renderDefault(makeRenderInput());
    const start = html.indexOf('id="tab-quality"');
    const end = html.indexOf('id="tab-roles"');
    const panel = html.slice(start, end);
    for (const id of ["bugThroughputChart", "bugCycleTimeChart", "devTimeAllocationChart", "bugBacklogChart"]) {
      expect(panel, `canvas ${id}`).toContain(`id="${id}"`);
    }
  });

  it("panel Avancé contient lead/cycle normalisés + flow efficiency + by-size charts", () => {
    const html = renderDefault(makeRenderInput());
    const start = html.indexOf('id="tab-advanced"');
    const panel = html.slice(start);
    for (const id of ["leadNormalizedChart", "cycleNormalizedChart", "flowEfficiencyChart", "leadBySizeChart", "cycleBySizeChart"]) {
      expect(panel, `canvas ${id}`).toContain(`id="${id}"`);
    }
  });

  it("canvas ids des métriques role-aware présents (panel Rôles)", () => {
    const html = renderDefault(makeRenderInput());
    for (const id of ["stageTimeByRoleChart", "stageTimeShareChart", "wipPerRoleChart", "stageThroughputGapChart", "reworkRatioChart", "reworkByTypeChart", "ftrByRoleChart"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("conserve les fonctionnalités legacy : help-btn, zoom-btn (via initZoom), modal", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).toContain('class="help-btn"');
    expect(html).toContain('class="help-popover"');
    expect(html).toContain("chart-modal-overlay");
    expect(html).toContain("initZoom");
    expect(html).toContain("zoom-btn");
  });

  it("ne référence plus le toggle theme ni la classe html.dark", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).not.toContain("themeToggle");
    expect(html).not.toContain("lean-theme");
    expect(html).not.toContain("html.dark");
  });

  it("8 cellules KPI rendues avec sparkline canvas", () => {
    const html = renderDefault(makeRenderInput());
    const sparkMatches = html.match(/class="spark"/g) ?? [];
    expect(sparkMatches.length).toBe(8);
    const cellMatches = html.match(/class="kpi-cell/g) ?? [];
    expect(cellMatches.length).toBe(8);
  });
});

describe("buildRoleSeries", () => {
  const rows: SnapshotRow[] = [
    { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "dev", stat: "median", value: 2 },
    { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "qa",  stat: "median", value: 1 },
    { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "po",  stat: "median", value: 0.5 },
    { snapshot_date: "2025-01-12", metric_name: "stage-time-breakdown", bucket: "dev", stat: "median", value: 3 },
    { snapshot_date: "2025-01-12", metric_name: "stage-time-breakdown", bucket: "qa",  stat: "median", value: 1.5 },
    // po absent à 2025-01-12
  ];

  it("dates triées, series pour chaque bucket", () => {
    const result = buildRoleSeries(rows, ["dev", "qa", "po"], "median");
    expect(result.dates).toEqual(["2025-01-05", "2025-01-12"]);
    expect(result.series["dev"]).toEqual([2, 3]);
    expect(result.series["qa"]).toEqual([1, 1.5]);
  });

  it("rôle absent pour une date → 0 (pas d'erreur)", () => {
    const result = buildRoleSeries(rows, ["dev", "qa", "po"], "median");
    const poIdx = result.dates.indexOf("2025-01-12");
    expect(result.series["po"][poIdx]).toBe(0);
  });

  it("aucune donnée → dates et séries vides", () => {
    const result = buildRoleSeries([], ["dev", "qa", "po"], "median");
    expect(result.dates).toHaveLength(0);
  });

  it("filtre par stat uniquement", () => {
    const rowsWithP85: SnapshotRow[] = [
      ...rows,
      { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "dev", stat: "p85", value: 5 },
    ];
    const result = buildRoleSeries(rowsWithP85, ["dev"], "median");
    expect(result.series["dev"]).toEqual([2, 3]);
  });
});

function makeScopeData(overrides: Partial<ScopeChangeResult> = {}): ScopeChangeResult {
  return {
    totalIssues: 0,
    changedIssues: 0,
    changeRatio: 0,
    bySprint: {},
    changedIssueKeys: [],
    ...overrides,
  };
}

function makeSprintStats(overrides: Partial<SprintScopeStats> = {}): SprintScopeStats {
  return { totalIssues: 0, changedIssues: 0, changeRatio: 0, byChangeType: { description: 0 }, issueDetails: [], ...overrides };
}

describe("isScopeChangeAvailable", () => {
  it("retourne true si la table issue_field_changes existe", () => {
    const db = createTestDb();
    expect(isScopeChangeAvailable(db)).toBe(true);
  });

  it("retourne false si la table issue_field_changes est absente", () => {
    const db = createTestDb();
    db.exec("DROP TABLE IF EXISTS issue_field_changes");
    expect(isScopeChangeAvailable(db)).toBe(false);
  });
});

describe("buildScopeAlertBanner", () => {
  it("retourne chaîne vide si changedIssues = 0", () => {
    const db = createTestDb();
    const result = buildScopeAlertBanner(db, makeScopeData({ changedIssues: 0 }));
    expect(result).toBe("");
  });

  it("retourne bannière si le sprint actif a des changements", () => {
    const db = createTestDb();
    upsertSprints(db, [{ id: 1, name: "KECK Sprint 45", state: "active", startDate: "2025-01-06T00:00:00.000Z", endDate: "2025-01-20T00:00:00.000Z", boardId: 1 }]);
    const scopeData = makeScopeData({
      changedIssues: 2,
      bySprint: {
        "KECK Sprint 45": makeSprintStats({ totalIssues: 5, changedIssues: 2, changeRatio: 0.4, byChangeType: { description: 1 } }),
      },
    });
    const result = buildScopeAlertBanner(db, scopeData);
    expect(result).toContain("alert-orange");
    expect(result).toContain("2 issue(s)");
    expect(result).toContain("KECK Sprint 45");
  });

  it("retourne chaîne vide si les changements sont uniquement sur le sprint précédent (closed)", () => {
    const db = createTestDb();
    upsertSprints(db, [
      { id: 1, name: "KECK Sprint 45", state: "active", startDate: "2025-01-20T00:00:00.000Z", endDate: "2025-02-03T00:00:00.000Z", boardId: 1 },
      { id: 2, name: "KECK Sprint 44", state: "closed", startDate: "2025-01-06T00:00:00.000Z", endDate: "2025-01-20T00:00:00.000Z", boardId: 1 },
    ]);
    const scopeData = makeScopeData({
      changedIssues: 3,
      bySprint: {
        "KECK Sprint 44": makeSprintStats({ totalIssues: 8, changedIssues: 3, changeRatio: 0.375, byChangeType: { description: 2 } }),
      },
    });
    const result = buildScopeAlertBanner(db, scopeData);
    expect(result).toBe("");
  });

  it("retourne chaîne vide si les changements sont uniquement sur des sprints anciens", () => {
    const db = createTestDb();
    upsertSprints(db, [
      { id: 1, name: "KECK Sprint 45", state: "active", startDate: "2025-01-20T00:00:00.000Z", endDate: "2025-02-03T00:00:00.000Z", boardId: 1 },
      { id: 2, name: "KECK Sprint 44", state: "closed", startDate: "2025-01-06T00:00:00.000Z", endDate: "2025-01-20T00:00:00.000Z", boardId: 1 },
    ]);
    const scopeData = makeScopeData({
      changedIssues: 3,
      bySprint: {
        "KECK Sprint 40": makeSprintStats({ totalIssues: 5, changedIssues: 3, changeRatio: 0.6, byChangeType: { description: 2 } }),
      },
    });
    const result = buildScopeAlertBanner(db, scopeData);
    expect(result).toBe("");
  });
});

describe("buildScopeChangeChart", () => {
  it("trie les sprints par numéro croissant", () => {
    const scopeData = makeScopeData({
      bySprint: {
        "KECK Sprint 43": makeSprintStats({ totalIssues: 5, changedIssues: 1, changeRatio: 0.2, byChangeType: { description: 1 } }),
        "KECK Sprint 41": makeSprintStats({ totalIssues: 4, changedIssues: 2, changeRatio: 0.5, byChangeType: { description: 1 } }),
        "KECK Sprint 42": makeSprintStats({ totalIssues: 6, changedIssues: 0, changeRatio: 0,   byChangeType: { description: 0 } }),
      },
    });
    const result = buildScopeChangeChart(scopeData);
    const parsed = JSON.parse(result);
    expect(parsed.data.labels).toEqual(["KECK Sprint 41", "KECK Sprint 42", "KECK Sprint 43"]);
  });

  it("retourne un graphe vide si bySprint est vide", () => {
    const result = buildScopeChangeChart(makeScopeData());
    const parsed = JSON.parse(result);
    expect(parsed.data.labels).toHaveLength(0);
  });
});

describe("buildScopeSection", () => {
  it("affiche 'Aucune dérive' quand bySprint est vide", () => {
    const db = createTestDb();
    const html = buildScopeSection(makeScopeData(), db, "https://test.atlassian.net");
    expect(html).toContain("No scope drift detected.");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<table");
  });

  it("affiche le graphe quand bySprint est non vide", () => {
    const db = createTestDb();
    const scopeData = makeScopeData({
      bySprint: {
        "Sprint 1": { totalIssues: 3, changedIssues: 1, changeRatio: 0.33, byChangeType: { description: 1 }, issueDetails: [{ key: "P-1", description: true }] },
      },
      changedIssueKeys: ["P-1"],
    });
    upsertIssues(db, [makeIssue({ key: "P-1", summary: "Ma US" })]);
    const html = buildScopeSection(scopeData, db, "https://test.atlassian.net");
    expect(html).toContain("<canvas");
    expect(html).not.toContain("No scope drift detected.");
  });

  it("mappe chaque issue à son sprint réel dans le tableau (2 issues, 2 sprints différents)", () => {
    const db = createTestDb();
    upsertIssues(db, [
      makeIssue({ key: "P-1", summary: "Issue alpha" }),
      makeIssue({ key: "P-2", summary: "Issue beta" }),
    ]);
    const scopeData = makeScopeData({
      changedIssues: 2,
      changedIssueKeys: ["P-1", "P-2"],
      bySprint: {
        "Sprint 1": { totalIssues: 5, changedIssues: 1, changeRatio: 0.2, byChangeType: { description: 1 }, issueDetails: [{ key: "P-1", description: true }] },
        "Sprint 2": { totalIssues: 4, changedIssues: 1, changeRatio: 0.25, byChangeType: { description: 0 }, issueDetails: [{ key: "P-2", description: false }] },
      },
    });
    const html = buildScopeSection(scopeData, db, "https://test.atlassian.net");
    const p1Idx = html.indexOf("P-1");
    const p2Idx = html.indexOf("P-2");
    const sprint1AfterP1 = html.indexOf("Sprint 1", p1Idx);
    const sprint2AfterP2 = html.indexOf("Sprint 2", p2Idx);
    expect(sprint1AfterP1).toBeGreaterThan(p1Idx);
    expect(sprint2AfterP2).toBeGreaterThan(p2Idx);
  });

  it("affiche l'issue et son sprint dans le tableau sans colonne Changements", () => {
    const db = createTestDb();
    upsertIssues(db, [makeIssue({ key: "P-3", summary: "US modifiée" })]);
    const scopeData = makeScopeData({
      changedIssues: 1,
      changedIssueKeys: ["P-3"],
      bySprint: {
        "Sprint 5": { totalIssues: 2, changedIssues: 1, changeRatio: 0.5, byChangeType: { description: 1 }, issueDetails: [{ key: "P-3", description: true }] },
      },
    });
    const html = buildScopeSection(scopeData, db, "https://test.atlassian.net");
    expect(html).toContain("P-3");
    expect(html).toContain("Sprint 5");
    expect(html).toContain("US modifiée");
    expect(html).not.toContain("Changements");
    expect(html).not.toContain("Story Points");
    expect(html).not.toContain("Reprogrammé");
  });
});

describe("renderDefault — Bottleneck panel", () => {
  it("affiche primaryColumn dans le badge si non null", () => {
    const input: RenderInput = {
      ...makeRenderInput(),
      bottleneck: {
        count: 1, primaryBottleneck: "dev", primaryColumn: "In Progress",
        recommendation: "Réduire les entrées en dev.",
        byRole: {
          dev: { score: 0.7, rank: 1, dominantSignal: "stage_time" as const, dominantColumn: "In Progress", signals: { stageTimeMedianDays: 5, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
          qa:  { score: 0.3, rank: 2, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
          po:  { score: 0,   rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        },
        byColumn: [{ column: "In Progress", role: "dev", medianDays: 5, count: 1 }],
      },
    };
    const html = renderDefault(input);
    expect(html).toContain("DEV (In Progress)");
  });

  it("n'affiche pas de parenthèse si primaryColumn est null", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).not.toMatch(/DEV \(/);
  });

  it("panel drill-down contient statut, médiane et count si byColumn non vide", () => {
    const input: RenderInput = {
      ...makeRenderInput(),
      bottleneck: {
        count: 1, primaryBottleneck: "dev", primaryColumn: "In Progress",
        recommendation: "Réduire les entrées en dev.",
        byRole: {
          dev: { score: 0.7, rank: 1, dominantSignal: "stage_time" as const, dominantColumn: "In Progress", signals: { stageTimeMedianDays: 5, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
          qa:  { score: 0.3, rank: 2, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
          po:  { score: 0,   rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        },
        byColumn: [{ column: "In Progress", role: "dev", medianDays: 5, count: 20 }],
      },
    };
    const html = renderDefault(input);
    expect(html).toContain("In Progress");
    expect(html).toContain("5.0j");
    expect(html).toContain("(20)");
    expect(html).toContain("Drill-down by column");
  });

  it("panel drill-down absent si byColumn vide", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).not.toContain("Drill-down par colonne");
  });
});

// ─── estimationFlags ───────────────────────────────────────────────────────────

describe("estimationFlags — méthode none", () => {
  it("désactive tout", () => {
    const f = estimationFlags({ method: "none" });
    expect(f.showWeighted).toBe(false);
    expect(f.showNormalized).toBe(false);
    expect(f.showBySize).toBe(false);
  });

  it("contextLabel contient 'aucune'", () => {
    expect(estimationFlags({ method: "none" }).contextLabel).toContain("none");
  });
});

describe("estimationFlags — méthode t-shirt", () => {
  it("masque weighted et normalized, active by-size", () => {
    const f = estimationFlags({ method: "t-shirt", jiraField: "customfield_10200" });
    expect(f.showWeighted).toBe(false);
    expect(f.showNormalized).toBe(false);
    expect(f.showBySize).toBe(true);
  });
});

describe("estimationFlags — méthode time", () => {
  it("tout visible, unit=j-h", () => {
    const f = estimationFlags({ method: "time" });
    expect(f.showWeighted).toBe(true);
    expect(f.showNormalized).toBe(true);
    expect(f.showBySize).toBe(true);
    expect(f.weightedUnit).toBe("j-h");
  });
});

describe("estimationFlags — méthode story-points", () => {
  it("showNormalized=false, unit=SP, seuils défaut dans contextLabel", () => {
    const f = estimationFlags({ method: "story-points" });
    expect(f.showWeighted).toBe(true);
    expect(f.showNormalized).toBe(false);
    expect(f.weightedUnit).toBe("SP");
    expect(f.contextLabel).toContain("XS<1");
    expect(f.contextLabel).toContain("M<8");
  });
});

describe("estimationFlags — méthode numeric", () => {
  it("unit=pts, contextLabel contient 'champ custom'", () => {
    const f = estimationFlags({ method: "numeric", jiraField: "cf", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } });
    expect(f.weightedUnit).toBe("pts");
    expect(f.contextLabel).toContain("custom field");
  });
});

// ─── renderHtml — masquage conditionnel ───────────────────────────────────────

describe("renderDefault — méthode none", () => {
  it("throughput pondéré masqué", () => {
    const html = renderDefault(makeInput({ method: "none" }));
    expect(isHidden(html, "Weighted throughput")).toBe(true);
  });

  it("lead normalisé masqué", () => {
    const html = renderDefault(makeInput({ method: "none" }));
    expect(isHidden(html, "Normalized lead")).toBe(true);
  });

  it("cycle normalisé masqué", () => {
    const html = renderDefault(makeInput({ method: "none" }));
    expect(isHidden(html, "Normalized cycle")).toBe(true);
  });

  it("lead by-size masqué", () => {
    const html = renderDefault(makeInput({ method: "none" }));
    expect(html).toContain('style="display:none"');
    expect(html).toMatch(/class="chart-card" style="display:none"[^>]*>\s*\n?\s*<h3>Lead time by size/);
  });

  it("bandeau mention aucune", () => {
    const html = renderDefault(makeInput({ method: "none" }));
    expect(html).toContain("none");
    expect(html).toContain("estimation-context");
  });
});

describe("renderDefault — méthode time (défaut)", () => {
  it("throughput pondéré visible", () => {
    const html = renderDefault(makeInput({ method: "time" }));
    expect(isVisible(html, "Weighted throughput")).toBe(true);
    expect(isHidden(html, "Weighted throughput")).toBe(false);
  });

  it("lead normalisé visible", () => {
    const html = renderDefault(makeInput({ method: "time" }));
    expect(isHidden(html, "Normalized lead")).toBe(false);
  });

  it("titre throughput contient 'estimated j-h'", () => {
    const html = renderDefault(makeInput({ method: "time" }));
    expect(html).toContain("estimated j-h");
  });

  it("bandeau toujours présent et contient label 'Estimation : temps'", () => {
    const html = renderDefault(makeInput({ method: "time" }));
    expect(html).toContain("estimation-context");
    expect(html).toContain("Estimation: time");
  });

  it("note normalisée contient 'ratio based on estimates'", () => {
    const html = renderDefault(makeInput({ method: "time" }));
    expect(html).toContain("ratio based on estimates");
  });

  it("note normalisée absente pour méthode none", () => {
    const html = renderDefault(makeInput({ method: "none" }));
    expect(html).not.toContain("ratio based on estimates");
  });
});

describe("renderDefault — méthode t-shirt", () => {
  it("throughput pondéré masqué", () => {
    const html = renderDefault(makeInput({ method: "t-shirt", jiraField: "customfield_10200" }));
    expect(isHidden(html, "Weighted throughput")).toBe(true);
  });

  it("by-size visible", () => {
    const html = renderDefault(makeInput({ method: "t-shirt", jiraField: "customfield_10200" }));
    expect(html).toMatch(/class="chart-card">\s*\n?\s*<h3>Lead time by size/);
  });
});

describe("renderDefault — méthode story-points", () => {
  it("titre throughput contient 'estimated SP'", () => {
    const html = renderDefault(makeInput({ method: "story-points" }));
    expect(html).toContain("estimated SP");
  });

  it("lead normalisé masqué", () => {
    const html = renderDefault(makeInput({ method: "story-points" }));
    expect(isHidden(html, "Normalized lead")).toBe(true);
  });

  it("cycle normalisé masqué", () => {
    const html = renderDefault(makeInput({ method: "story-points" }));
    expect(isHidden(html, "Normalized cycle")).toBe(true);
  });

  it("bandeau contient seuils SP", () => {
    const html = renderDefault(makeInput({ method: "story-points" }));
    expect(html).toContain("XS&lt;1");
  });
});

describe("renderDefault — estimation absente (implicite time)", () => {
  it("estimation undefined → sections normalisées visibles", () => {
    const html = renderDefault(makeInput(undefined));
    expect(isHidden(html, "Normalized lead")).toBe(false);
    expect(isHidden(html, "Weighted throughput")).toBe(false);
  });

  it("estimation undefined → bandeau 'Estimation : temps'", () => {
    const html = renderDefault(makeInput(undefined));
    expect(html).toContain("Estimation: time");
  });
});

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
});

describe("renderDefault — toggle sprint/semaines", () => {
  it("toggle absent si sprintCharts est null", () => {
    const html = renderDefault({ ...makeRenderInput(), sprintCharts: null });
    expect(html).not.toContain('id="debit-toggle"');
  });

  it("toggle présent si sprintCharts non null", () => {
    const sprintCharts = {
      throughput: { labels: ["Sprint 1"], series: { count: [5] }, hasActiveSprint: false },
      bugThroughput: { labels: ["Sprint 1"], series: { count: [1] }, hasActiveSprint: false },
      throughputWeighted: { labels: ["Sprint 1"], series: { estimatedDays: [3.5] }, hasActiveSprint: false },
    };
    const html = renderDefault({ ...makeRenderInput(), sprintCharts });
    expect(html).toContain('id="debit-toggle"');
    expect(html).toContain("SPRINT_CHARTS");
  });

  it("SPRINT_CHARTS est null dans le JS si sprintCharts est null", () => {
    const html = renderDefault({ ...makeRenderInput(), sprintCharts: null });
    expect(html).toContain("const SPRINT_CHARTS = null");
  });
});

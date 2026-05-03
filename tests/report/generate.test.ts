import { describe, it, expect } from "vitest";
import { issueLink, agingRowsHtml, buildBucketSeries, syncMetaLabel, staleBannerHtml, computeMovingAvg, renderHtml } from "../../src/report/generate";
import type { AgingWipSummary } from "../../src/metrics/agingWip";
import type { SnapshotRow } from "../../src/snapshots/compute";

type RenderInput = Parameters<typeof renderHtml>[0];

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
  };
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
    expect(syncMetaLabel(null)).toBe("Données Jira : jamais synchronisé");
  });

  it("affiche la date tronquée au format YYYY-MM-DD HH:MM", () => {
    expect(syncMetaLabel("2026-04-28T10:30:00Z")).toBe("Données Jira du 2026-04-28 10:30");
  });

  it("fonctionne avec un timestamp ISO sans milliseconde", () => {
    expect(syncMetaLabel("2026-01-15T08:05:00.000Z")).toBe("Données Jira du 2026-01-15 08:05");
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
    expect(html).toContain("jamais effectué");
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
    expect(html).toContain("Aucun item en cours");
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

describe("renderHtml — groupement thématique", () => {
  it("accordéon métriques avancées est fermé par défaut (attribut open absent)", () => {
    const html = renderHtml(makeRenderInput());
    expect(html).toContain('<details class="advanced-section">');
    expect(html).not.toMatch(/<details[^>]+open/);
  });

  it("3 sections H2 dans l'ordre Livraison → Bugs → Capacité", () => {
    const html = renderHtml(makeRenderInput());
    const livraisonPos = html.indexOf("<h2>Livraison</h2>");
    const bugsPos = html.indexOf("<h2>Bugs");
    const capacitePos = html.indexOf("<h2>Capacité");
    expect(livraisonPos).toBeGreaterThan(-1);
    expect(bugsPos).toBeGreaterThan(livraisonPos);
    expect(capacitePos).toBeGreaterThan(bugsPos);
  });

  it("section Livraison contient les 4 KPIs livraison, pas les KPIs bugs", () => {
    const html = renderHtml(makeRenderInput());
    const livSection = html.slice(html.indexOf("<h2>Livraison</h2>"), html.indexOf("<h2>Bugs"));
    expect(livSection).toContain("Lead time médian");
    expect(livSection).toContain("Cycle time médian");
    expect(livSection).toContain("Throughput (7j)");
    expect(livSection).toContain("WIP");
    expect(livSection).not.toContain("Bugs livrés");
    expect(livSection).not.toContain("Bug cycle");
  });

  it("accordéon contient les graphes avancés dans l'ordre : lead normalisé, cycle normalisé, flow efficiency + by-size trends", () => {
    const html = renderHtml(makeRenderInput());
    const detailsStart = html.indexOf('<details class="advanced-section">');
    const detailsEnd = html.indexOf("</details>", detailsStart);
    const accordeon = html.slice(detailsStart, detailsEnd);
    expect(accordeon).toContain("leadNormalizedChart");
    expect(accordeon).toContain("cycleNormalizedChart");
    expect(accordeon).toContain("flowEfficiencyChart");
    expect(accordeon).toContain("leadBySizeChart");
    expect(accordeon).toContain("cycleBySizeChart");
    expect(accordeon.indexOf("leadNormalizedChart")).toBeLessThan(accordeon.indexOf("cycleNormalizedChart"));
    expect(accordeon.indexOf("cycleNormalizedChart")).toBeLessThan(accordeon.indexOf("flowEfficiencyChart"));
  });

  it("section Bugs contient les KPIs bugs", () => {
    const html = renderHtml(makeRenderInput());
    const bugsSection = html.slice(html.indexOf("<h2>Bugs"), html.indexOf("<h2>Capacité"));
    expect(bugsSection).toContain("Bugs livrés (7j)");
    expect(bugsSection).toContain("Bug cycle médian");
    expect(bugsSection).toContain("Bug ratio moyen");
  });
});

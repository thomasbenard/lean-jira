import { describe, it, expect } from "vitest";
import { issueLink, agingRowsHtml, buildBucketSeries, syncMetaLabel, staleBannerHtml } from "../../src/report/generate";
import type { AgingWipSummary } from "../../src/metrics/agingWip";
import type { SnapshotRow } from "../../src/snapshots/compute";

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

import { describe, it, expect, beforeEach } from "vitest";
import { issueLink, agingRowsHtml, syncMetaLabel, staleBannerHtml } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import type { AgingWipSummary } from "../../src/metrics/agingWip";

beforeEach(() => { initLocale("en"); });

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

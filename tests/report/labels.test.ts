import { describe, it, expect, beforeEach } from "vitest";
import { buildReportLabels, syncMetaLabel, staleBannerHtml, agingRowsHtml } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import type { AgingWipSummary } from "../../src/metrics/agingWip";

const BASE = "https://example.atlassian.net";

const emptyAging = (): AgingWipSummary => ({
  asOf: "2025-01-01",
  count: 0,
  percentiles: { p50: 1, p85: 3, p95: 5 },
  riskCounts: { ok: 0, watch: 0, atRisk: 0, critical: 0 },
  issues: [],
  unit: "j",
});

beforeEach(() => {
  initLocale("en");
});

describe("buildReportLabels", () => {
  it("retourne les labels de tabs en anglais pour lang='en'", () => {
    const labels = buildReportLabels("en");
    expect(labels["report.tab.delivery"]).toBe("Delivery");
    expect(labels["report.tab.quality"]).toBe("Quality & bugs");
    expect(labels["report.tab.roles"]).toBe("Flow by role");
    expect(labels["report.tab.forecast"]).toBe("Forecast & aging");
    expect(labels["report.tab.scope"]).toBe("Scope drift");
    expect(labels["report.tab.advanced"]).toBe("Advanced");
  });

  it("retourne les labels de tabs en français pour lang='fr'", () => {
    const labels = buildReportLabels("fr");
    expect(labels["report.tab.delivery"]).toBe("Livraison");
    expect(labels["report.tab.quality"]).toBe("Qualité & bugs");
    expect(labels["report.tab.roles"]).toBe("Flux par rôle");
    expect(labels["report.tab.forecast"]).toBe("Forecast & aging");
    expect(labels["report.tab.scope"]).toBe("Dérive de périmètre");
    expect(labels["report.tab.advanced"]).toBe("Avancé");
  });

  it("retourne les labels de verdict en anglais", () => {
    const labels = buildReportLabels("en");
    expect(labels["report.verdict.alert"]).toBe("⚠ ALERT");
    expect(labels["report.verdict.watch"]).toBe("◐ WATCH");
    expect(labels["report.verdict.ok"]).toBe("✓ HEALTHY");
  });

  it("retourne les labels de verdict en français", () => {
    const labels = buildReportLabels("fr");
    expect(labels["report.verdict.alert"]).toBe("⚠ ALERTE");
    expect(labels["report.verdict.watch"]).toBe("◐ VIGILANCE");
    expect(labels["report.verdict.ok"]).toBe("✓ SAIN");
  });

  it("retourne les help titles en anglais", () => {
    const labels = buildReportLabels("en");
    expect(labels["report.help.leadTime.title"]).toBe("Lead time");
    expect(labels["report.help.cycleTime.title"]).toBe("Cycle time");
    expect(labels["report.help.throughput.title"]).toBe("Throughput");
    expect(labels["report.help.forecast.title"]).toBe("Monte Carlo Forecast");
  });
});

describe("syncMetaLabel — locale EN", () => {
  it("retourne le texte anglais 'never synced' si null", () => {
    expect(syncMetaLabel(null)).toBe("Jira data: never synced");
  });

  it("retourne le texte anglais avec date si lastSyncAt présent", () => {
    expect(syncMetaLabel("2026-04-28T10:30:00Z")).toBe("Jira data: 2026-04-28 10:30");
  });
});

describe("staleBannerHtml — locale EN", () => {
  it("retourne chaîne vide si isSyncStale = false", () => {
    expect(staleBannerHtml(false, "2026-04-28T10:30:00Z")).toBe("");
  });

  it("contient 'never synced' si lastSyncAt = null", () => {
    const html = staleBannerHtml(true, null);
    expect(html).toContain("stale-warning");
    expect(html).toContain("never synced");
    expect(html).not.toContain("jamais effectué");
  });

  it("contient la date si lastSyncAt présent", () => {
    const html = staleBannerHtml(true, "2026-04-22T10:30:00Z");
    expect(html).toContain("stale-warning");
    expect(html).toContain("2026-04-22");
  });
});

describe("agingRowsHtml — locale EN", () => {
  it("retourne le message anglais si aucun item", () => {
    const html = agingRowsHtml(emptyAging(), BASE);
    expect(html).toContain("No items in progress");
    expect(html).not.toContain("Aucun item en cours");
  });
});

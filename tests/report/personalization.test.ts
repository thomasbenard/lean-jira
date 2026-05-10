import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolvePersonalization, renderHtml } from "../../src/report/generate";
import type { AgingWipSummary } from "../../src/metrics/agingWip";
import type { ForecastSummary } from "../../src/metrics/forecast";

type RenderInput = Parameters<typeof renderHtml>[0];

function makeRenderInput(overrides: Partial<RenderInput> = {}): RenderInput {
  const empty = { dates: [], series: {} };
  return {
    projectKey: "TEST",
    jiraBaseUrl: "https://test.atlassian.net",
    generatedAt: "2025-01-01 00:00:00",
    lastSnapshotDate: "2025-01-01",
    lastSyncAt: null,
    isSyncStale: false,
    kpis: {
      leadTimeMedian: null, cycleTimeMedian: null, throughputCount: null,
      wipCount: null, bugThroughputCount: null, bugCycleTimeMedian: null,
      flowEfficiencyAggregate: null, devTimeAvgBugRatio: null,
      stageTimeDevMedian: null, stageTimeQaMedian: null, stageTimePoMedian: null,
      wipDev: null, wipQa: null, wipPo: null,
      reworkRatio: null, avgReworks: null, ftrDev: null, ftrQa: null, ftrPo: null,
    },
    charts: {
      leadTime: empty, cycleTime: empty, throughput: empty,
      throughputWeighted: empty, wip: empty, bugThroughput: empty,
      bugCycleTime: empty, leadTimeNormalized: empty, cycleTimeNormalized: empty,
      flowEfficiency: empty, agingWipRisk: empty, devTimeAllocation: empty,
      bugBacklog: empty, stageTimeByRole: empty, stageTimeByRoleP85: empty,
      stageTimeShare: empty, wipPerRole: empty, stageThroughputNet: empty,
      handoffReworkRatio: empty, handoffReworkByType: empty, ftrByRole: empty,
      bottleneckScores: empty,
    },
    leadBySize: {},
    cycleBySize: {},
    leadTimeBySizeCharts: {},
    cycleTimeBySizeCharts: {},
    agingWip: {
      asOf: "2025-01-01", count: 0,
      percentiles: { p50: 0, p85: 0, p95: 0 },
      riskCounts: { ok: 0, watch: 0, atRisk: 0, critical: 0 },
      issues: [], unit: "j",
    } as AgingWipSummary,
    forecast: {
      recentWeeks: [], weeksUsed: 0, byHorizon: [], simulations: 0, unit: "issues",
    } as ForecastSummary,
    histogram: [],
    cycleStats: { median: 0, p85: 0, p95: 0, avg: 0, count: 0 },
    bottleneck: {
      count: 0, primaryBottleneck: null, recommendation: "",
      byRole: {
        dev: { score: 0, rank: 3, dominantSignal: "combined" as const, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        qa:  { score: 0, rank: 3, dominantSignal: "combined" as const, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        po:  { score: 0, rank: 3, dominantSignal: "combined" as const, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
      },
    },
    ...overrides,
  };
}

describe("resolvePersonalization", () => {
  const tmpDir = os.tmpdir();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retourne excludedTabs vide si personalization absent", () => {
    const result = resolvePersonalization(undefined, tmpDir);
    expect(result.excludedTabs.size).toBe(0);
    expect(result.logoDataUri).toBeUndefined();
    expect(result.customCss).toBeUndefined();
    expect(result.fontLinkHtml).toBeUndefined();
  });

  it("embarque un logo PNG local en data URI base64 (chemin absolu)", () => {
    const logoPath = path.join(tmpDir, "test-logo-028.png");
    const fakeContent = Buffer.from("PNG_BYTES");
    fs.writeFileSync(logoPath, fakeContent);
    try {
      const result = resolvePersonalization({ logoUrl: logoPath }, tmpDir);
      expect(result.logoDataUri).toMatch(/^data:image\/png;base64,/);
      expect(result.logoDataUri).toBe(`data:image/png;base64,${fakeContent.toString("base64")}`);
    } finally {
      fs.unlinkSync(logoPath);
    }
  });

  it("résout un logoUrl relatif depuis boardDir", () => {
    const logoFile = "relative-logo-028.png";
    const logoPath = path.join(tmpDir, logoFile);
    const fakeContent = Buffer.from("RELATIVE_PNG");
    fs.writeFileSync(logoPath, fakeContent);
    try {
      const result = resolvePersonalization({ logoUrl: `./${logoFile}` }, tmpDir);
      expect(result.logoDataUri).toBe(`data:image/png;base64,${fakeContent.toString("base64")}`);
    } finally {
      fs.unlinkSync(logoPath);
    }
  });

  it("lève une erreur si logo local introuvable", () => {
    const missing = path.join(tmpDir, "inexistant-logo-028.png");
    expect(() => resolvePersonalization({ logoUrl: missing }, tmpDir)).toThrow(/logoUrl introuvable/);
    expect(() => resolvePersonalization({ logoUrl: missing }, tmpDir)).toThrow(missing);
  });

  it("logue un warning et ignore le logo si extension non reconnue", () => {
    const bmpPath = path.join(tmpDir, "logo-028.bmp");
    fs.writeFileSync(bmpPath, "BMP");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = resolvePersonalization({ logoUrl: bmpPath }, tmpDir);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Extension logo non reconnue"));
      expect(result.logoDataUri).toBeUndefined();
    } finally {
      fs.unlinkSync(bmpPath);
    }
  });

  it("lève une erreur si logoUrl commence par data:", () => {
    expect(() =>
      resolvePersonalization({ logoUrl: "data:image/png;base64,abc" }, tmpDir)
    ).toThrow(/logoUrl ne peut pas commencer par "data:"/);
  });

  it("passe logoUrl distante telle quelle", () => {
    const result = resolvePersonalization({ logoUrl: "https://example.com/logo.png" }, tmpDir);
    expect(result.logoDataUri).toBe("https://example.com/logo.png");
  });

  it("lit un fichier CSS custom et retourne son contenu", () => {
    const cssPath = path.join(tmpDir, "custom-028.css");
    fs.writeFileSync(cssPath, ":root { --bg: #ffffff; }", "utf-8");
    try {
      const result = resolvePersonalization({ customCssPath: cssPath }, tmpDir);
      expect(result.customCss).toBe(":root { --bg: #ffffff; }");
    } finally {
      fs.unlinkSync(cssPath);
    }
  });

  it("lève une erreur si customCssPath introuvable", () => {
    const missing = path.join(tmpDir, "inexistant-028.css");
    expect(() => resolvePersonalization({ customCssPath: missing }, tmpDir)).toThrow(/customCssPath introuvable/);
  });

  it("construit un <link> pour fontUrl fourni", () => {
    const url = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap";
    const result = resolvePersonalization({ fontUrl: url }, tmpDir);
    expect(result.fontLinkHtml).toContain(url);
    expect(result.fontLinkHtml).toContain("<link");
  });

  it("traite fontUrl chaîne vide comme absent", () => {
    const result = resolvePersonalization({ fontUrl: "" }, tmpDir);
    expect(result.fontLinkHtml).toBeUndefined();
  });

  it("peuple excludedTabs pour valeurs connues", () => {
    const result = resolvePersonalization({ excludeTabs: ["roles", "forecast"] }, tmpDir);
    expect(result.excludedTabs.has("roles")).toBe(true);
    expect(result.excludedTabs.has("forecast")).toBe(true);
    expect(result.excludedTabs.size).toBe(2);
  });

  it("logue un warning pour valeur inconnue dans excludeTabs et l'ignore", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = resolvePersonalization({ excludeTabs: ["roles", "inexistant"] }, tmpDir);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`onglet inconnu "inexistant"`));
    expect(result.excludedTabs.has("roles")).toBe(true);
    expect(result.excludedTabs.has("inexistant")).toBe(false);
  });
});

describe("renderHtml — personnalisation", () => {
  it("remplace le titre dans <title> et le header", () => {
    const html = renderHtml(makeRenderInput({
      personalization: {
        title: "Équipe Plateforme",
        excludedTabs: new Set(),
      },
    }));
    expect(html).toContain("<title>Équipe Plateforme</title>");
    expect(html).toContain("Équipe Plateforme");
  });

  it("conserve le titre par défaut si absent (Rapport Lean — projectKey)", () => {
    const html = renderHtml(makeRenderInput());
    expect(html).toContain("<title>Rapport Lean — TEST</title>");
  });

  it("injecte le logo dans le header", () => {
    const html = renderHtml(makeRenderInput({
      personalization: {
        logoDataUri: "data:image/png;base64,ABC==",
        excludedTabs: new Set(),
      },
    }));
    expect(html).toContain(`<img src="data:image/png;base64,ABC=="`);
  });

  it("n'injecte pas de <img> si logoDataUri absent", () => {
    const html = renderHtml(makeRenderInput());
    expect(html).not.toContain("<img");
  });

  it("remplace le <link> Google Fonts par fontLinkHtml fourni", () => {
    const customFont = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">';
    const html = renderHtml(makeRenderInput({
      personalization: {
        fontLinkHtml: customFont,
        excludedTabs: new Set(),
      },
    }));
    expect(html).toContain("family=Inter");
    expect(html).not.toContain("IBM+Plex");
  });

  it("conserve IBM Plex si fontLinkHtml absent", () => {
    const html = renderHtml(makeRenderInput());
    expect(html).toContain("IBM+Plex");
  });

  it("injecte CSS custom dans un second bloc <style> après le premier", () => {
    const css = ":root { --bg: #ffffff; }";
    const html = renderHtml(makeRenderInput({
      personalization: {
        customCss: css,
        excludedTabs: new Set(),
      },
    }));
    const firstStyle = html.indexOf("</style>");
    const secondStyle = html.indexOf("<style>", firstStyle + 1);
    expect(secondStyle).toBeGreaterThan(firstStyle);
    expect(html).toContain(css);
  });

  it("exclut l'onglet roles de la barre de navigation et du contenu", () => {
    const html = renderHtml(makeRenderInput({
      personalization: {
        excludedTabs: new Set(["roles"]),
      },
    }));
    expect(html).not.toContain('data-tab="roles"');
    expect(html).not.toContain('id="tab-roles"');
  });

  it("n'affiche aucune barre d'onglets si tous les onglets sont exclus", () => {
    const html = renderHtml(makeRenderInput({
      personalization: {
        excludedTabs: new Set(["delivery", "quality", "roles", "forecast", "advanced"]),
      },
    }));
    expect(html).not.toContain('class="tabs"');
    expect(html).toContain("Indicateurs clés");
  });

  it("décale la classe active si le premier onglet est exclu", () => {
    const html = renderHtml(makeRenderInput({
      personalization: {
        excludedTabs: new Set(["delivery"]),
      },
    }));
    expect(html).not.toContain('data-tab="delivery"');
    const activeBtn = html.match(/class="tab active"[^>]*data-tab="([^"]+)"/);
    expect(activeBtn?.[1]).toBe("quality");
    const activePanel = html.match(/class="tab-panel active"[^>]*id="tab-([^"]+)"/);
    expect(activePanel?.[1]).toBe("quality");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildTemplateContext,
  renderWithHandlebars,
  exportDefaultTemplate,
} from "../../src/report/generate";
import type { AgingWipSummary } from "../../src/metrics/agingWip";
import type { ForecastSummary } from "../../src/metrics/forecast";

type RenderInput = Parameters<typeof import("../../src/report/generate").renderWithHandlebars>[0];

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
      count: 0, primaryBottleneck: null, primaryColumn: null, recommendation: "",
      byRole: {
        dev: { score: 0, rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        qa:  { score: 0, rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
        po:  { score: 0, rank: 3, dominantSignal: "combined" as const, dominantColumn: null, signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 } },
      },
      byColumn: [],
    },
    ...overrides,
  };
}

describe("buildTemplateContext", () => {
  it("title par défaut = 'Lean Report — {projectKey}'", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], "{}");
    expect(ctx.title).toBe("Lean Report — TEST");
  });

  it("title personnalisé depuis personalization", () => {
    const input = makeRenderInput({
      personalization: { excludedTabs: new Set(), title: "Mon rapport custom" },
    });
    const ctx = buildTemplateContext(input, [], "{}");
    expect(ctx.title).toBe("Mon rapport custom");
  });

  it("headerLogoHtml vide si pas de logo", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], "{}");
    expect(ctx.headerLogoHtml).toBe("");
  });

  it("headerLogoHtml contient <img> si logoDataUri fourni", () => {
    const input = makeRenderInput({
      personalization: { excludedTabs: new Set(), logoDataUri: "data:image/png;base64,abc" },
    });
    const ctx = buildTemplateContext(input, [], "{}");
    expect(ctx.headerLogoHtml).toContain("<img");
    expect(ctx.headerLogoHtml).toContain("data:image/png;base64,abc");
  });

  it("customStyleHtml vide si pas de CSS custom", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], "{}");
    expect(ctx.customStyleHtml).toBe("");
  });

  it("customStyleHtml = <style>...</style> si CSS custom fourni", () => {
    const input = makeRenderInput({
      personalization: { excludedTabs: new Set(), customCss: "body { color: red; }" },
    });
    const ctx = buildTemplateContext(input, [], "{}");
    expect(ctx.customStyleHtml).toContain("<style>");
    expect(ctx.customStyleHtml).toContain("body { color: red; }");
  });

  it("tabs filtrés depuis renderedTabs selon excludedTabs", () => {
    const input = makeRenderInput({
      personalization: { excludedTabs: new Set(["roles"]) },
    });
    const rendered = [
      { id: "delivery", label: "Livraison", html: "<p>delivery</p>" },
      { id: "roles", label: "Rôles", html: "<p>roles</p>" },
    ];
    const ctx = buildTemplateContext(input, rendered, "{}");
    expect(ctx.tabs.map((t) => t.id)).toEqual(["delivery"]);
  });

  it("chartDataJson passé tel quel au contexte", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], '{"key":"val"}');
    expect(ctx.chartDataJson).toBe('{"key":"val"}');
  });

  it("premier tab visible a active=true", () => {
    const rendered = [
      { id: "delivery", label: "Livraison", html: "" },
      { id: "quality", label: "Qualité", html: "" },
    ];
    const ctx = buildTemplateContext(makeRenderInput(), rendered, "{}");
    expect(ctx.tabs[0].active).toBe(true);
    expect(ctx.tabs[1].active).toBe(false);
  });

  it("projectKey et metadata transmis correctement", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], "{}");
    expect(ctx.projectKey).toBe("TEST");
    expect(ctx.generatedAt).toBe("2025-01-01 00:00:00");
    expect(ctx.lastSnapshotDate).toBe("2025-01-01");
    expect(ctx.isSyncStale).toBe(false);
    expect(ctx.lastSyncAt).toBeNull();
  });
});

describe("renderWithHandlebars", () => {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `lean-test-${Date.now()}.hbs`);

  afterEach(() => {
    if (fs.existsSync(tmpFile)) { fs.unlinkSync(tmpFile); }
  });

  it("template minimal {{title}} → rendu avec valeur correcte", () => {
    fs.writeFileSync(tmpFile, "{{escapeHtml title}}");
    const result = renderWithHandlebars(makeRenderInput(), tmpFile);
    expect(result).toBe("Lean Report — TEST");
  });

  it("template avec variable inexistante → chaîne vide, pas d'erreur", () => {
    fs.writeFileSync(tmpFile, "{{variableInexistante}}");
    expect(() => renderWithHandlebars(makeRenderInput(), tmpFile)).not.toThrow();
    const result = renderWithHandlebars(makeRenderInput(), tmpFile);
    expect(result).toBe("");
  });

  it("template vide → output vide, code 0", () => {
    fs.writeFileSync(tmpFile, "");
    expect(() => renderWithHandlebars(makeRenderInput(), tmpFile)).not.toThrow();
    expect(renderWithHandlebars(makeRenderInput(), tmpFile)).toBe("");
  });

  it("template inexistant → throw avec chemin dans le message", () => {
    const missing = path.join(tmpDir, "inexistant.hbs");
    expect(() => renderWithHandlebars(makeRenderInput(), missing)).toThrow(missing);
  });

  it("syntaxe Handlebars invalide → throw avec 'Erreur de rendu du template Handlebars'", () => {
    fs.writeFileSync(tmpFile, "{{#if}}non fermé");
    expect(() => renderWithHandlebars(makeRenderInput(), tmpFile))
      .toThrow("Erreur de rendu du template Handlebars");
  });

  it("helper fmt_float formate nombre avec décimales", () => {
    fs.writeFileSync(tmpFile, "{{fmt_float cycleStats.median 1}}");
    const input = makeRenderInput({ cycleStats: { median: 3.14, p85: 0, p95: 0, avg: 0, count: 0 } });
    const result = renderWithHandlebars(input, tmpFile);
    expect(result).toBe("3.1");
  });

  it("helper json sérialise objet en JSON", () => {
    fs.writeFileSync(tmpFile, "{{json kpis}}");
    const result = renderWithHandlebars(makeRenderInput(), tmpFile);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe("exportDefaultTemplate", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("crée le répertoire et exporte report.hbs + context.schema.json", () => {
    tmpDir = path.join(os.tmpdir(), `lean-export-${Date.now()}`);
    exportDefaultTemplate(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, "report.hbs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "context.schema.json"))).toBe(true);
  });

  it("report.hbs exporté est un template Handlebars valide (compilable)", () => {
    const Handlebars = require("handlebars");
    tmpDir = path.join(os.tmpdir(), `lean-export-${Date.now()}`);
    exportDefaultTemplate(tmpDir);
    const src = fs.readFileSync(path.join(tmpDir, "report.hbs"), "utf-8");
    expect(() => Handlebars.compile(src)).not.toThrow();
  });

  it("répertoire inexistant → créé automatiquement", () => {
    tmpDir = path.join(os.tmpdir(), `lean-export-${Date.now()}`, "nested", "dir");
    expect(() => exportDefaultTemplate(tmpDir)).not.toThrow();
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  it("report.hbs existe déjà → throw avec message explicite", () => {
    tmpDir = path.join(os.tmpdir(), `lean-export-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "report.hbs"), "existant");
    expect(() => exportDefaultTemplate(tmpDir)).toThrow();
    // fichier non modifié
    expect(fs.readFileSync(path.join(tmpDir, "report.hbs"), "utf-8")).toBe("existant");
  });
});

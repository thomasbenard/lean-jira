import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { renderWithHandlebars } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import type { EstimationConfig } from "../../src/metrics/types";
import { makeRenderInput, type RenderInput } from "./renderInputFixture";

beforeEach(() => { initLocale("en"); });

function renderDefault(input: RenderInput): string {
  const templatePath = path.join(__dirname, "../../src/report/templates/report.hbs");
  return renderWithHandlebars(input, templatePath);
}

function makeInput(estimation?: EstimationConfig): RenderInput {
  return makeRenderInput({ estimation });
}

function isHidden(html: string, title: string): boolean {
  return new RegExp(`class="chart-card" style="display:none"[^>]*>\\s*<h3>(?:<span[^>]*>)?${title}`).test(html);
}
function isVisible(html: string, title: string): boolean {
  return new RegExp(`class="chart-card">\\s*<h3>(?:<span[^>]*>)?${title}`).test(html);
}

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

describe("renderDefault — Bottleneck panel", () => {
  it("affiche primaryColumn dans le badge si non null", () => {
    const input = makeRenderInput({
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
    });
    const html = renderDefault(input);
    expect(html).toContain("DEV (In Progress)");
  });

  it("n'affiche pas de parenthèse si primaryColumn est null", () => {
    const html = renderDefault(makeRenderInput());
    expect(html).not.toMatch(/DEV \(/);
  });

  it("panel drill-down contient statut, médiane et count si byColumn non vide", () => {
    const input = makeRenderInput({
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
    });
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

describe("renderDefault — toggle sprint/semaines", () => {
  it("toggle absent si sprintCharts est null", () => {
    const html = renderDefault(makeRenderInput({ sprintCharts: null }));
    expect(html).not.toContain('id="debit-toggle"');
  });

  it("toggle présent si sprintCharts non null", () => {
    const sprintCharts = {
      throughput: { labels: ["Sprint 1"], series: { count: [5] }, hasActiveSprint: false },
      bugThroughput: { labels: ["Sprint 1"], series: { count: [1] }, hasActiveSprint: false },
      throughputWeighted: { labels: ["Sprint 1"], series: { estimatedDays: [3.5] }, hasActiveSprint: false },
      leadTime: { labels: ["Sprint 1"], series: { median: [3], p85: [5] }, hasActiveSprint: false },
      cycleTime: { labels: ["Sprint 1"], series: { median: [2], p85: [4] }, hasActiveSprint: false },
      bugCycleTime: { labels: ["Sprint 1"], series: { median: [2], p85: [4] }, hasActiveSprint: false },
      devTimeAllocation: { labels: ["Sprint 1"], series: { featureDays: [3], bugDays: [1], bugRatio: [0.25] }, hasActiveSprint: false },
    };
    const html = renderDefault(makeRenderInput({ sprintCharts }));
    expect(html).toContain('id="debit-toggle"');
    expect(html).toContain("SPRINT_CHARTS");
    expect(html).toContain("SPRINT_CHARTS.bugCycleTime");
    expect(html).toContain("SPRINT_CHARTS.devTimeAllocation");
  });

  it("SPRINT_CHARTS est null dans le JS si sprintCharts est null", () => {
    const html = renderDefault(makeRenderInput({ sprintCharts: null }));
    expect(html).toContain("const SPRINT_CHARTS = null");
  });
});

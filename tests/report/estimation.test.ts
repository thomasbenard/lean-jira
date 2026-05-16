import { describe, it, expect, beforeEach } from "vitest";
import { estimationFlags } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";

beforeEach(() => { initLocale("en"); });

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

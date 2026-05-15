import { describe, it, expect, beforeEach } from "vitest";
import { serializeChartDefs, CHART_DEFS } from "../../src/report/chartDefs";
import { initLocale } from "../../src/i18n/index";

beforeEach(() => { initLocale("en"); });

describe("serializeChartDefs", () => {
  it("retourne un JSON valide avec les titres résolus", () => {
    const json = serializeChartDefs(CHART_DEFS, (key: string) => `[${key}]`);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("title");
    expect(parsed[0].title).toBe(`[${CHART_DEFS[0].titleKey}]`);
    expect(parsed[0]).not.toHaveProperty("titleKey");
  });

  it("conserve tous les champs sauf titleKey", () => {
    const json = serializeChartDefs(CHART_DEFS, (k: string) => k);
    const parsed = JSON.parse(json);
    for (const def of parsed) {
      expect(def).toHaveProperty("id");
      expect(def).toHaveProperty("key");
      expect(def).toHaveProperty("tab");
      expect(def).toHaveProperty("chart");
      expect(def).not.toHaveProperty("titleKey");
    }
  });
});

describe("CHART_DEFS", () => {
  it("couvre tous les 23 keys du hardcoded charts object", () => {
    const expectedKeys = [
      "leadTime", "cycleTime", "throughput", "throughputWeighted", "wip",
      "bugThroughput", "bugCycleTime", "leadTimeNormalized", "cycleTimeNormalized",
      "flowEfficiency", "agingWipRisk", "devTimeAllocation", "bugBacklog",
      "stageTimeByRole", "stageTimeByRoleP85", "stageTimeShare", "wipPerRole",
      "stageThroughputNet", "handoffReworkRatio", "handoffReworkByType",
      "ftrByRole", "bottleneckScores", "reworkCost",
    ];
    const registryKeys = CHART_DEFS.filter((d) => d.data !== null).map((d) => d.key);
    for (const k of expectedKeys) {
      expect(registryKeys).toContain(k);
    }
  });

  it("pas de doublons sur id", () => {
    const ids = CHART_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

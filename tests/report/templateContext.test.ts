import { describe, it, expect, beforeEach } from "vitest";
import { buildTemplateContext } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import { makeRenderInput } from "./renderInputFixture";

beforeEach(() => { initLocale("en"); });

describe("buildTemplateContext", () => {
  it("chartDefsJson est un JSON valide avec id et title résolus", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], "{}");
    const parsed = JSON.parse(ctx.chartDefsJson);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("title");
    expect(parsed[0]).not.toHaveProperty("titleKey");
  });

  it("estimationFlagsJson est un JSON valide avec showWeighted et weightedUnit", () => {
    const ctx = buildTemplateContext(makeRenderInput(), [], "{}");
    const parsed = JSON.parse(ctx.estimationFlagsJson);
    expect(typeof parsed.showWeighted).toBe("boolean");
    expect(typeof parsed.weightedUnit).toBe("string");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { validateEstimationConfig } from "../../src/main";

describe("validateEstimationConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ne fait rien si cfg est undefined", () => {
    expect(() => validateEstimationConfig(undefined)).not.toThrow();
  });

  it("ne fait rien pour méthode time", () => {
    expect(() => validateEstimationConfig({ method: "time" })).not.toThrow();
  });

  it("ne fait rien pour méthode story-points sans jiraField (implicite)", () => {
    expect(() => validateEstimationConfig({ method: "story-points" })).not.toThrow();
  });

  it("ne fait rien pour méthode story-points avec jiraField custom", () => {
    expect(() => validateEstimationConfig({ method: "story-points", jiraField: "customfield_99999" })).not.toThrow();
  });

  it("ne fait rien pour méthode none", () => {
    expect(() => validateEstimationConfig({ method: "none" })).not.toThrow();
  });

  it("appelle process.exit(1) pour numeric sans jiraField", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => validateEstimationConfig({ method: "numeric" })).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("ne fait rien pour numeric avec jiraField et bucketThresholds", () => {
    expect(() => validateEstimationConfig({ method: "numeric", jiraField: "customfield_10099", bucketThresholds: { xs: 1, s: 3, m: 8, l: 13 } })).not.toThrow();
  });

  it("appelle process.exit(1) pour t-shirt sans jiraField", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => validateEstimationConfig({ method: "t-shirt" })).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("ne fait rien pour t-shirt avec jiraField", () => {
    expect(() => validateEstimationConfig({ method: "t-shirt", jiraField: "customfield_10200" })).not.toThrow();
  });

  it("appelle process.exit(1) pour numeric avec jiraField mais sans bucketThresholds", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => validateEstimationConfig({ method: "numeric", jiraField: "customfield_10099" })).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("ne fait rien pour numeric avec jiraField et bucketThresholds", () => {
    expect(() => validateEstimationConfig({
      method: "numeric",
      jiraField: "customfield_10099",
      bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 },
    })).not.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { resolveEstimationField } from "../../src/metrics/types";

describe("resolveEstimationField", () => {
  it("retourne timeoriginalestimate pour méthode time", () => {
    expect(resolveEstimationField({ method: "time" })).toBe("timeoriginalestimate");
  });

  it("retourne customfield_10016 pour story-points sans jiraField", () => {
    expect(resolveEstimationField({ method: "story-points" })).toBe("customfield_10016");
  });

  it("retourne le jiraField custom pour story-points avec override", () => {
    expect(resolveEstimationField({ method: "story-points", jiraField: "customfield_99999" })).toBe("customfield_99999");
  });

  it("retourne null pour numeric sans jiraField", () => {
    expect(resolveEstimationField({ method: "numeric" })).toBeNull();
  });

  it("retourne le jiraField pour numeric", () => {
    expect(resolveEstimationField({ method: "numeric", jiraField: "customfield_10099" })).toBe("customfield_10099");
  });

  it("retourne null pour t-shirt sans jiraField", () => {
    expect(resolveEstimationField({ method: "t-shirt" })).toBeNull();
  });

  it("retourne le jiraField pour t-shirt", () => {
    expect(resolveEstimationField({ method: "t-shirt", jiraField: "customfield_10200" })).toBe("customfield_10200");
  });

  it("retourne null pour none", () => {
    expect(resolveEstimationField({ method: "none" })).toBeNull();
  });
});

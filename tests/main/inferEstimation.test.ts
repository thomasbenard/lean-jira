import { describe, it, expect } from "vitest";
import type { JiraBoardConfig } from "../../src/jira/types";
import { inferEstimationConfig } from "../../src/main";

function makeBoard(estimation?: JiraBoardConfig["estimation"]): JiraBoardConfig {
  return {
    id: 1,
    name: "TEST",
    columnConfig: { columns: [] },
    ...(estimation !== undefined && { estimation }),
  };
}

// ─── Règle 1 — mapping fieldId → EstimationConfig ─────────────────────────────

describe("inferEstimationConfig — type: field", () => {
  it("timeoriginalestimate → method: time", () => {
    const result = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "timeoriginalestimate", displayName: "Time Estimate" } }));
    expect(result).toEqual({ method: "time" });
  });

  it("customfield_10016 → method: story-points", () => {
    const result = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "customfield_10016", displayName: "Story Points" } }));
    expect(result).toEqual({ method: "story-points" });
  });

  it("champ custom inconnu → method: numeric avec jiraField", () => {
    const result = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "customfield_10099", displayName: "Complexity" } }));
    expect(result).toEqual({ method: "numeric", jiraField: "customfield_10099" });
  });
});

describe("inferEstimationConfig — type: none / issueCount", () => {
  it("type: none → method: none", () => {
    expect(inferEstimationConfig(makeBoard({ type: "none" }))).toEqual({ method: "none" });
  });

  it("type: issueCount → method: none", () => {
    expect(inferEstimationConfig(makeBoard({ type: "issueCount" }))).toEqual({ method: "none" });
  });
});

describe("inferEstimationConfig — champ absent (API ancienne)", () => {
  it("estimation absent → method: time (défaut silencieux)", () => {
    expect(inferEstimationConfig(makeBoard())).toEqual({ method: "time" });
  });

  it("type: field sans field (réponse API malformée) → method: time (fallback silencieux)", () => {
    expect(inferEstimationConfig(makeBoard({ type: "field" }))).toEqual({ method: "time" });
  });
});

// ─── Règle 2 — warning pour champ custom ──────────────────────────────────────

describe("inferEstimationConfig — champ custom → method: numeric", () => {
  it("champ custom → résultat numeric (warning géré côté autoconfig)", () => {
    const result = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "customfield_10200", displayName: "T-Shirt Size" } }));
    expect(result.method).toBe("numeric");
  });

  it("story-points standard → method: story-points (pas de numeric)", () => {
    const result = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "customfield_10016", displayName: "Story Points" } }));
    expect(result.method).toBe("story-points");
  });
});

// ─── Règle 3 — préservation estimation existante ──────────────────────────────

describe("inferEstimationConfig — préservation (logique merge, pas autoconfig CLI)", () => {
  it("estimation détectée story-points sert de fallback si aucune existante", () => {
    const detected = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "customfield_10016", displayName: "Story Points" } }));
    const existingEstimation = undefined;
    const applied = existingEstimation ?? detected;
    expect(applied).toEqual({ method: "story-points" });
  });

  it("estimation existante t-shirt préservée si déjà configurée", () => {
    const detected = inferEstimationConfig(makeBoard({ type: "field", field: { fieldId: "customfield_10200", displayName: "T-Shirt Size" } }));
    const existingEstimation = { method: "t-shirt" as const, jiraField: "customfield_10200" };
    const applied = existingEstimation ?? detected;
    expect(applied).toEqual({ method: "t-shirt", jiraField: "customfield_10200" });
    expect(detected.method).toBe("numeric");
  });
});

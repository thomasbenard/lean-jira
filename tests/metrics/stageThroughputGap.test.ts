import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { stageThroughputGapMetric } from "../../src/metrics/stageThroughputGap";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

const ROLE_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  devStatuses: ["In Progress"],
  qaStatuses: ["In Review"],
  poStatuses: ["To Validate"],
};

describe("stageThroughputGapMetric.compute", () => {
  it("retourne byWeek vide si aucune transition", () => {
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.byWeek).toHaveLength(0);
    expect(result.avgNetByRole).toEqual({ dev: 0, qa: 0, po: 0 });
  });

  it("retourne byWeek vide avec avertissement si aucun rôle configuré", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" },
    ]);
    const noRoleConfig: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: [],
      qaStatuses: [],
      poStatuses: [],
    };
    const result = stageThroughputGapMetric.compute(createTestContext(db, noRoleConfig));
    expect(result.byWeek).toHaveLength(0);
    expect(result.avgNetByRole).toEqual({ dev: 0, qa: 0, po: 0 });
  });

  it("entrée simple dans dev sans sortie → 1 entrée, 0 sortie", () => {
    // Lundi 2025-W10 = 2025-03-03
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" },
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].week).toBe("2025-W10");
    expect(result.byWeek[0].devIn).toBe(1);
    expect(result.byWeek[0].devOut).toBe(0);
    expect(result.byWeek[0].devNet).toBe(1);
    expect(result.byWeek[0].qaIn).toBe(0);
    expect(result.byWeek[0].qaOut).toBe(0);
  });

  it("transition dev→qa → 1 sortie dev + 1 entrée qa dans la bonne semaine", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // W10: devIn=1
      { to: "In Review",   at: "2025-03-05T09:00:00Z" }, // W10: devOut=1, qaIn=1
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.byWeek).toHaveLength(1);
    const w = result.byWeek[0];
    expect(w.week).toBe("2025-W10");
    expect(w.devIn).toBe(1);
    expect(w.devOut).toBe(1);
    expect(w.devNet).toBe(0);
    expect(w.qaIn).toBe(1);
    expect(w.qaOut).toBe(0);
    expect(w.qaNet).toBe(1);
  });

  it("rework dev→qa→dev → 2 entrées dev, 1 sortie dev, 1 entrée qa, 1 sortie qa", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // devIn=1
      { to: "In Review",   at: "2025-03-05T09:00:00Z" }, // devOut=1, qaIn=1
      { to: "In Progress", at: "2025-03-07T09:00:00Z" }, // qaOut=1, devIn=1
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    // Toutes en W10 (03-03 à 03-09)
    const w10 = result.byWeek.find((w) => w.week === "2025-W10");
    expect(w10).toBeDefined();
    expect(w10!.devIn).toBe(2);
    expect(w10!.devOut).toBe(1);
    expect(w10!.devNet).toBe(1);
    expect(w10!.qaIn).toBe(1);
    expect(w10!.qaOut).toBe(1);
    expect(w10!.qaNet).toBe(0);
  });

  it("sortie po vers done compte comme une sortie po", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Validate", at: "2025-03-03T09:00:00Z" }, // poIn=1
      { to: "Done",        at: "2025-03-05T09:00:00Z" }, // poOut=1 (done n'est pas un rôle)
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    const w = result.byWeek[0];
    expect(w.poIn).toBe(1);
    expect(w.poOut).toBe(1);
    expect(w.poNet).toBe(0);
    expect(w.devIn).toBe(0);
    expect(w.qaIn).toBe(0);
  });

  it("transitions dans des semaines différentes → plusieurs lignes byWeek triées", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // W10
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "In Review",   at: "2025-03-10T09:00:00Z" }, // W11
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    expect(result.byWeek).toHaveLength(2);
    expect(result.byWeek[0].week).toBe("2025-W10");
    expect(result.byWeek[1].week).toBe("2025-W11");
    expect(result.byWeek[0].devIn).toBe(1);
    expect(result.byWeek[1].qaIn).toBe(1);
  });

  it("transitions intra-rôle ne comptent pas (deux statuts dev consécutifs)", () => {
    // Deux statuts dans le même rôle dev → 1 seule entrée, 0 sortie
    const configDevDouble: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["In Progress", "In Dev"],
      qaStatuses: ["In Review"],
      poStatuses: [],
    };
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // devIn=1
      { to: "In Dev",      at: "2025-03-04T09:00:00Z" }, // même rôle → rien
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, configDevDouble));
    const w = result.byWeek[0];
    expect(w.devIn).toBe(1);
    expect(w.devOut).toBe(0);
  });

  it("cutoffDate filtre les transitions antérieures", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-01-06T09:00:00Z" }, // avant cutoff
      { to: "In Review",   at: "2025-03-03T09:00:00Z" }, // après cutoff
    ]);
    const cfg = { ...ROLE_CONFIG, cutoffDate: "2025-02-01" };
    const result = stageThroughputGapMetric.compute(createTestContext(db, cfg));
    // seule la transition du 03-03 passe → qaIn=1, pas de devIn
    const w = result.byWeek.find((w) => w.week === "2025-W10");
    expect(w).toBeDefined();
    expect(w!.qaIn).toBe(1);
    // devIn absent car devOut du 01-06 filtré
    expect(w!.devIn).toBe(0);
  });

  it("windowEndDate filtre les transitions postérieures", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // inclus
      { to: "In Review",   at: "2025-03-20T09:00:00Z" }, // après fenêtre
    ]);
    const cfg = { ...ROLE_CONFIG, windowEndDate: "2025-03-10" };
    const result = stageThroughputGapMetric.compute(createTestContext(db, cfg));
    expect(result.byWeek).toHaveLength(1);
    expect(result.byWeek[0].devIn).toBe(1);
    expect(result.byWeek[0].devOut).toBe(0);
  });

  it("applique excludeIssueTypes", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", issueType: "Bug" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2", issueType: "Story" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" },
    ]);
    const cfg = { ...ROLE_CONFIG, excludeIssueTypes: ["Bug"] };
    const result = stageThroughputGapMetric.compute(createTestContext(db, cfg));
    // seul PROJ-2 → devIn=1
    expect(result.byWeek[0].devIn).toBe(1);
  });

  it("rôle non configuré → In/Out/Net=0 pour ce rôle", () => {
    const noPoConfig: MetricConfig = {
      ...ROLE_CONFIG,
      poStatuses: [],
    };
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" },
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, noPoConfig));
    expect(result.byWeek[0].poIn).toBe(0);
    expect(result.byWeek[0].poOut).toBe(0);
    expect(result.byWeek[0].poNet).toBe(0);
  });

  it("avgNetByRole est la moyenne des netFlow hebdomadaires", () => {
    // W10: devIn=2, devOut=1 → devNet=1
    // W11: devIn=0, devOut=1 → devNet=-1
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // W10 devIn=1
      { to: "In Review",   at: "2025-03-10T09:00:00Z" }, // W11 devOut=1, qaIn=1
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "In Progress", at: "2025-03-03T09:00:00Z" }, // W10 devIn=1
    ]);
    const result = stageThroughputGapMetric.compute(createTestContext(db, ROLE_CONFIG));
    // W10: devIn=2, devOut=0, devNet=2
    // W11: devIn=0, devOut=1 (sortie de PROJ-1), qaIn=1, devNet=-1
    expect(result.avgNetByRole.dev).toBeCloseTo((2 + (-1)) / 2);
  });
});

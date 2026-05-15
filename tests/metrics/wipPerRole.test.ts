import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, resetSeq, TEST_CONFIG } from "../helpers/seeders";
import { upsertIssues } from "../../src/db/store";
import { wipPerRoleMetric } from "../../src/metrics/wipPerRole";
import { createTestContext } from "../_helpers/createTestContext";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

const CONFIG_WITH_ROLES: MetricConfig = {
  ...TEST_CONFIG,
  devStatuses: ["In Progress"],
  qaStatuses: ["In Review"],
  poStatuses: ["To Validate"],
};

describe("wipPerRoleMetric.compute", () => {
  it("retourne vide avec avertissement si aucun rôle configuré", () => {
    upsertIssues(db, [makeIssue({ currentStatus: "In Progress" })]);
    const result = wipPerRoleMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.byRole.dev.count).toBe(0);
    expect(result.byRole.qa.count).toBe(0);
    expect(result.byRole.po.count).toBe(0);
    expect(result.byRole.dev.issueKeys).toHaveLength(0);
  });

  it("compte les issues dans les statuts dev", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentStatus: "In Progress" }),
      makeIssue({ key: "PROJ-2", currentStatus: "In Progress" }),
      makeIssue({ key: "PROJ-3", currentStatus: "In Review" }),
    ]);
    const result = wipPerRoleMetric.compute(createTestContext(db, CONFIG_WITH_ROLES));
    expect(result.byRole.dev.count).toBe(2);
    expect(result.byRole.dev.issueKeys).toContain("PROJ-1");
    expect(result.byRole.dev.issueKeys).toContain("PROJ-2");
  });

  it("compte les issues dans les statuts qa", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentStatus: "In Review" }),
      makeIssue({ key: "PROJ-2", currentStatus: "In Progress" }),
    ]);
    const result = wipPerRoleMetric.compute(createTestContext(db, CONFIG_WITH_ROLES));
    expect(result.byRole.qa.count).toBe(1);
    expect(result.byRole.qa.issueKeys).toEqual(["PROJ-1"]);
  });

  it("compte les issues dans les statuts po", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentStatus: "To Validate" }),
      makeIssue({ key: "PROJ-2", currentStatus: "To Validate" }),
    ]);
    const result = wipPerRoleMetric.compute(createTestContext(db, CONFIG_WITH_ROLES));
    expect(result.byRole.po.count).toBe(2);
    expect(result.byRole.po.issueKeys).toHaveLength(2);
  });

  it("rôle sans statuts configurés → count=0 et issueKeys vide", () => {
    const configSansQa: MetricConfig = {
      ...CONFIG_WITH_ROLES,
      qaStatuses: [],
    };
    upsertIssues(db, [makeIssue({ currentStatus: "In Review" })]);
    const result = wipPerRoleMetric.compute(createTestContext(db, configSansQa));
    expect(result.byRole.qa.count).toBe(0);
    expect(result.byRole.qa.issueKeys).toHaveLength(0);
  });

  it("applique excludeIssueTypes", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentStatus: "In Progress", issueType: "Bug" }),
      makeIssue({ key: "PROJ-2", currentStatus: "In Progress", issueType: "Story" }),
    ]);
    const result = wipPerRoleMetric.compute(createTestContext(db, {
      ...CONFIG_WITH_ROLES,
      excludeIssueTypes: ["Bug"],
    }));
    expect(result.byRole.dev.count).toBe(1);
    expect(result.byRole.dev.issueKeys).toEqual(["PROJ-2"]);
  });

  it("issues done ne sont pas filtrées (WIP point-in-time basé sur current_status)", () => {
    // current_status peut être 'To Validate' (statut PO/done) — doit compter
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentStatus: "To Validate" }),
    ]);
    const result = wipPerRoleMetric.compute(createTestContext(db, CONFIG_WITH_ROLES));
    expect(result.byRole.po.count).toBe(1);
  });

  it("pas de scoping sprint — compte toutes les issues indépendamment du sprint", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", currentStatus: "In Progress", currentSprintId: 1 }),
      makeIssue({ key: "PROJ-2", currentStatus: "In Progress", currentSprintId: null }),
    ]);
    const result = wipPerRoleMetric.compute(createTestContext(db, CONFIG_WITH_ROLES));
    expect(result.byRole.dev.count).toBe(2);
  });
});

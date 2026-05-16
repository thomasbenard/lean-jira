import { describe, it, expect, beforeEach } from "vitest";
import { buildScopeAlertBanner, buildScopeChangeChart, buildScopeSection } from "../../src/report/generate";
import { initLocale } from "../../src/i18n/index";
import type { ScopeChangeResult, SprintScopeStats } from "../../src/metrics/scopeChange";
import { createTestDb } from "../helpers/db";
import { SqliteStore } from "../../src/store/sqlite";
import { makeIssue } from "../helpers/seeders";

beforeEach(() => { initLocale("en"); });

function makeScopeData(overrides: Partial<ScopeChangeResult> = {}): ScopeChangeResult {
  return {
    totalIssues: 0,
    changedIssues: 0,
    changeRatio: 0,
    bySprint: {},
    changedIssueKeys: [],
    ...overrides,
  };
}

function makeSprintStats(overrides: Partial<SprintScopeStats> = {}): SprintScopeStats {
  return { totalIssues: 0, changedIssues: 0, changeRatio: 0, byChangeType: { description: 0 }, issueDetails: [], ...overrides };
}

describe("buildScopeAlertBanner", () => {
  it("retourne chaîne vide si changedIssues = 0", () => {
    const db = createTestDb();
    const result = buildScopeAlertBanner(new SqliteStore(db), makeScopeData({ changedIssues: 0 }));
    expect(result).toBe("");
  });

  it("retourne bannière si le sprint actif a des changements", () => {
    const db = createTestDb();
    new SqliteStore(db).sprints.upsertMany([{ id: 1, name: "KECK Sprint 45", state: "active", startDate: "2025-01-06T00:00:00.000Z", endDate: "2025-01-20T00:00:00.000Z", boardId: 1 }]);
    const scopeData = makeScopeData({
      changedIssues: 2,
      bySprint: {
        "KECK Sprint 45": makeSprintStats({ totalIssues: 5, changedIssues: 2, changeRatio: 0.4, byChangeType: { description: 1 } }),
      },
    });
    const result = buildScopeAlertBanner(new SqliteStore(db), scopeData);
    expect(result).toContain("alert-orange");
    expect(result).toContain("2 issue(s)");
    expect(result).toContain("KECK Sprint 45");
  });

  it("retourne chaîne vide si les changements sont uniquement sur le sprint précédent (closed)", () => {
    const db = createTestDb();
    new SqliteStore(db).sprints.upsertMany([
      { id: 1, name: "KECK Sprint 45", state: "active", startDate: "2025-01-20T00:00:00.000Z", endDate: "2025-02-03T00:00:00.000Z", boardId: 1 },
      { id: 2, name: "KECK Sprint 44", state: "closed", startDate: "2025-01-06T00:00:00.000Z", endDate: "2025-01-20T00:00:00.000Z", boardId: 1 },
    ]);
    const scopeData = makeScopeData({
      changedIssues: 3,
      bySprint: {
        "KECK Sprint 44": makeSprintStats({ totalIssues: 8, changedIssues: 3, changeRatio: 0.375, byChangeType: { description: 2 } }),
      },
    });
    const result = buildScopeAlertBanner(new SqliteStore(db), scopeData);
    expect(result).toBe("");
  });

  it("retourne chaîne vide si les changements sont uniquement sur des sprints anciens", () => {
    const db = createTestDb();
    new SqliteStore(db).sprints.upsertMany([
      { id: 1, name: "KECK Sprint 45", state: "active", startDate: "2025-01-20T00:00:00.000Z", endDate: "2025-02-03T00:00:00.000Z", boardId: 1 },
      { id: 2, name: "KECK Sprint 44", state: "closed", startDate: "2025-01-06T00:00:00.000Z", endDate: "2025-01-20T00:00:00.000Z", boardId: 1 },
    ]);
    const scopeData = makeScopeData({
      changedIssues: 3,
      bySprint: {
        "KECK Sprint 40": makeSprintStats({ totalIssues: 5, changedIssues: 3, changeRatio: 0.6, byChangeType: { description: 2 } }),
      },
    });
    const result = buildScopeAlertBanner(new SqliteStore(db), scopeData);
    expect(result).toBe("");
  });
});

describe("buildScopeChangeChart", () => {
  it("trie les sprints par numéro croissant", () => {
    const scopeData = makeScopeData({
      bySprint: {
        "KECK Sprint 43": makeSprintStats({ totalIssues: 5, changedIssues: 1, changeRatio: 0.2, byChangeType: { description: 1 } }),
        "KECK Sprint 41": makeSprintStats({ totalIssues: 4, changedIssues: 2, changeRatio: 0.5, byChangeType: { description: 1 } }),
        "KECK Sprint 42": makeSprintStats({ totalIssues: 6, changedIssues: 0, changeRatio: 0,   byChangeType: { description: 0 } }),
      },
    });
    const result = buildScopeChangeChart(scopeData);
    const parsed = JSON.parse(result);
    expect(parsed.data.labels).toEqual(["KECK Sprint 41", "KECK Sprint 42", "KECK Sprint 43"]);
  });

  it("retourne un graphe vide si bySprint est vide", () => {
    const result = buildScopeChangeChart(makeScopeData());
    const parsed = JSON.parse(result);
    expect(parsed.data.labels).toHaveLength(0);
  });
});

describe("buildScopeSection", () => {
  it("affiche 'Aucune dérive' quand bySprint est vide", () => {
    const db = createTestDb();
    const html = buildScopeSection(makeScopeData(), new SqliteStore(db), "https://test.atlassian.net");
    expect(html).toContain("No scope drift detected.");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<table");
  });

  it("affiche le graphe quand bySprint est non vide", () => {
    const db = createTestDb();
    const scopeData = makeScopeData({
      bySprint: {
        "Sprint 1": { totalIssues: 3, changedIssues: 1, changeRatio: 0.33, byChangeType: { description: 1 }, issueDetails: [{ key: "P-1", description: true }] },
      },
      changedIssueKeys: ["P-1"],
    });
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "P-1", summary: "Ma US" })]);
    const html = buildScopeSection(scopeData, new SqliteStore(db), "https://test.atlassian.net");
    expect(html).toContain("<canvas");
    expect(html).not.toContain("No scope drift detected.");
  });

  it("mappe chaque issue à son sprint réel dans le tableau (2 issues, 2 sprints différents)", () => {
    const db = createTestDb();
    new SqliteStore(db).issues.upsertMany([
      makeIssue({ key: "P-1", summary: "Issue alpha" }),
      makeIssue({ key: "P-2", summary: "Issue beta" }),
    ]);
    const scopeData = makeScopeData({
      changedIssues: 2,
      changedIssueKeys: ["P-1", "P-2"],
      bySprint: {
        "Sprint 1": { totalIssues: 5, changedIssues: 1, changeRatio: 0.2, byChangeType: { description: 1 }, issueDetails: [{ key: "P-1", description: true }] },
        "Sprint 2": { totalIssues: 4, changedIssues: 1, changeRatio: 0.25, byChangeType: { description: 0 }, issueDetails: [{ key: "P-2", description: false }] },
      },
    });
    const html = buildScopeSection(scopeData, new SqliteStore(db), "https://test.atlassian.net");
    const p1Idx = html.indexOf("P-1");
    const p2Idx = html.indexOf("P-2");
    const sprint1AfterP1 = html.indexOf("Sprint 1", p1Idx);
    const sprint2AfterP2 = html.indexOf("Sprint 2", p2Idx);
    expect(sprint1AfterP1).toBeGreaterThan(p1Idx);
    expect(sprint2AfterP2).toBeGreaterThan(p2Idx);
  });

  it("affiche l'issue et son sprint dans le tableau sans colonne Changements", () => {
    const db = createTestDb();
    new SqliteStore(db).issues.upsertMany([makeIssue({ key: "P-3", summary: "US modifiée" })]);
    const scopeData = makeScopeData({
      changedIssues: 1,
      changedIssueKeys: ["P-3"],
      bySprint: {
        "Sprint 5": { totalIssues: 2, changedIssues: 1, changeRatio: 0.5, byChangeType: { description: 1 }, issueDetails: [{ key: "P-3", description: true }] },
      },
    });
    const html = buildScopeSection(scopeData, new SqliteStore(db), "https://test.atlassian.net");
    expect(html).toContain("P-3");
    expect(html).toContain("Sprint 5");
    expect(html).toContain("US modifiée");
    expect(html).not.toContain("Changements");
    expect(html).not.toContain("Story Points");
    expect(html).not.toContain("Reprogrammé");
  });
});

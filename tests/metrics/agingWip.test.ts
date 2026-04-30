import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import { agingWipMetric } from "../../src/metrics/agingWip";
import type Database from "better-sqlite3";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// windowEndDate fixe "now" de façon déterministe
const NOW = "2025-02-03"; // lundi

// Seed une issue livrée dans le passé (pour les percentiles historiques)
// La population historique exige : todoStatus + devStartStatus + doneStatus transitions
function seedHistorical(key: string, startAt: string, doneAt: string) {
  seedIssueWithTransitions(db, makeIssue({ key }), [
    { to: "To Do",       at: startAt },
    { to: "In Progress", at: startAt },
    { to: "Done",        at: doneAt },
  ]);
}

// Seed une issue actuellement en cours (WIP) au moment de `NOW`.
// Une seule transition "In Progress" suffit : satisfait first_dev (devStart)
// et last_status (dernier statut = In Progress) sans ambiguïté de tri.
function seedWipIssue(key: string, startedAt: string) {
  seedIssueWithTransitions(db, makeIssue({ key, resolvedAt: null }), [
    { to: "In Progress", at: startedAt },
  ]);
}

describe("agingWipMetric.compute", () => {
  it("retourne liste vide si aucune issue en cours", () => {
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    expect(result.count).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("exclut une issue résolue avant windowEndDate du WIP", () => {
    // Issue résolue le 1er jan → pas WIP au 3 fev
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1", resolvedAt: "2025-01-01T00:00:00Z" }), [
      { to: "To Do",       at: "2025-01-01T09:00:00Z" },
      { to: "In Progress", at: "2025-01-01T09:00:00Z" },
    ]);
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    expect(result.count).toBe(0);
  });

  it("identifie une issue en cours et calcule ageDays > 0", () => {
    seedWipIssue("PROJ-1", "2025-01-27T09:00:00Z"); // démarré lun 27 jan
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    expect(result.count).toBe(1);
    expect(result.issues[0].ageDays).toBeGreaterThan(0);
  });

  it("riskLevel=ok pour une issue récente sans historique", () => {
    seedWipIssue("PROJ-1", `${NOW}T08:00:00Z`);
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    expect(result.issues[0].riskLevel).toBe("ok");
  });

  it("sans historique cycle-time → tout est ok", () => {
    seedWipIssue("PROJ-1", "2025-01-06T09:00:00Z");
    seedWipIssue("PROJ-2", "2025-01-13T09:00:00Z");
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    result.issues.forEach((i) => expect(i.riskLevel).toBe("ok"));
  });

  it("classification risque correcte vs percentiles historiques", () => {
    // 3 issues historiques : cycles 1j, 2j, 3j
    // p50=2, p85=3, p95=3
    seedHistorical("H1", "2025-01-06T09:00:00Z", "2025-01-07T09:00:00Z"); // 1j
    seedHistorical("H2", "2025-01-06T09:00:00Z", "2025-01-08T09:00:00Z"); // 2j
    seedHistorical("H3", "2025-01-06T09:00:00Z", "2025-01-09T09:00:00Z"); // 3j

    // WIP démarré très tôt → âge >> p95 → critical
    seedWipIssue("WIP-1", "2025-01-06T09:00:00Z");

    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    const wip = result.issues.find((i) => i.issueKey === "WIP-1");
    expect(wip).toBeDefined();
    expect(wip!.riskLevel).toBe("critical");
  });

  it("issues triées par ageDays décroissant", () => {
    seedWipIssue("PROJ-1", "2025-01-06T09:00:00Z"); // plus ancien
    seedWipIssue("PROJ-2", "2025-01-27T09:00:00Z"); // plus récent
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    expect(result.issues[0].ageDays).toBeGreaterThanOrEqual(result.issues[1].ageDays);
  });

  it("percentiles calculés sur les issues livrées seulement (pas le WIP actuel)", () => {
    seedHistorical("H1", "2025-01-06T09:00:00Z", "2025-01-07T09:00:00Z");
    seedWipIssue("WIP-1", "2025-01-27T09:00:00Z");
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    // Les percentiles non-zéro indiquent que l'historique a été pris en compte
    expect(result.percentiles.p50).toBeGreaterThan(0);
  });

  it("riskCounts somme = nombre total d'issues WIP", () => {
    seedWipIssue("PROJ-1", "2025-01-06T09:00:00Z");
    seedWipIssue("PROJ-2", "2025-01-27T09:00:00Z");
    const result = agingWipMetric.compute(db, { ...TEST_CONFIG, windowEndDate: NOW });
    const { ok, watch, atRisk, critical } = result.riskCounts;
    expect(ok + watch + atRisk + critical).toBe(result.count);
  });
});

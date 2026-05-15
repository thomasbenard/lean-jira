import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, makeSprint, makeTransitions, resetSeq, TEST_CONFIG } from "../helpers/seeders";
import { SqliteStore } from "../../src/store/sqlite";
import { scopeChangeMetric, normalizeText, similarityRatio } from "../../src/metrics/scopeChange";
import type Database from "better-sqlite3";
import type { FieldChange } from "../../src/jira/types";
import { createTestContext } from "../_helpers/createTestContext";

let db: Database.Database;
let store: SqliteStore;
beforeEach(() => {
  db = createTestDb();
  store = new SqliteStore(db);
  resetSeq();
});

// Helpers locaux
function seedIssue(key: string) {
  store.issues.upsertMany([makeIssue({ key })]);
}

function seedSprint(id: number, name: string, startDate: string) {
  store.sprints.upsertMany([makeSprint({ id, name, state: "active", startDate, endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
}

function seedFieldChanges(key: string, changes: FieldChange[]) {
  store.issueFieldChanges.replaceForIssues([{ key, rows: changes }]);
}

// ─── normalizeText ──────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("passe en minuscules", () => {
    expect(normalizeText("Hello World")).toBe("hello world");
  });

  it("supprime les marqueurs Markdown courants", () => {
    expect(normalizeText("**gras** _italique_ ## titre")).not.toContain("*");
    expect(normalizeText("**gras** _italique_ ## titre")).not.toContain("#");
    expect(normalizeText("**gras** _italique_ ## titre")).not.toContain("_");
  });

  it("collapse les espaces multiples", () => {
    expect(normalizeText("un   double  espace")).toBe("un double espace");
  });

  it("supprime les retours à la ligne (collapse en espace)", () => {
    expect(normalizeText("ligne1\nligne2")).toBe("ligne1 ligne2");
  });

  it("retourne chaîne vide si tout est supprimé", () => {
    expect(normalizeText("   ")).toBe("");
  });
});

// ─── similarityRatio ────────────────────────────────────────────────────────

describe("similarityRatio", () => {
  it("retourne 1.0 pour des chaînes identiques", () => {
    expect(similarityRatio("Faire le module", "Faire le module")).toBe(1);
  });

  it("retourne 1.0 si les deux chaînes sont vides", () => {
    expect(similarityRatio("", "")).toBe(1);
  });

  it("≥ 0.85 pour ajout d'espaces (changement trivial)", () => {
    const ratio = similarityRatio("Faire le module de login", "Faire  le module de login  ");
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });

  it("≥ 0.85 pour correction d'une faute de frappe", () => {
    const ratio = similarityRatio(
      "Implémenter la fonciton d'export",
      "Implémenter la fonction d'export",
    );
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });

  it("< 0.85 pour suppression d'un paragraphe entier", () => {
    const longText = "Critère 1 : le système doit valider les entrées. Critère 2 : afficher une erreur explicite. Critère 3 : logger toute tentative. Critère 4 : envoyer un email de confirmation.";
    const shortened = "Critère 1 : le système doit valider les entrées.";
    const ratio = similarityRatio(longText, shortened);
    expect(ratio).toBeLessThan(0.85);
  });

  it("< 0.85 si to est vide et from est long", () => {
    const ratio = similarityRatio("Un texte assez long pour que la suppression soit significative", "");
    expect(ratio).toBeLessThan(0.85);
  });
});

// ─── scopeChangeMetric.compute — structure de base ──────────────────────────

describe("scopeChangeMetric.compute — structure de base", () => {
  it("retourne totalIssues = 0 si aucune donnée", () => {
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.totalIssues).toBe(0);
    expect(result.changedIssues).toBe(0);
    expect(result.changeRatio).toBe(0);
    expect(result.changedIssueKeys).toHaveLength(0);
    expect(result.bySprint).toEqual({});
  });

  it("exclut issue absente de issue_sprints (aucune appartenance sprint)", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "description", fromValue: "Avant", toValue: "Après", changedAt: "2025-03-15T10:00:00.000Z" },
    ]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.totalIssues).toBe(0);
  });

  it("exclut sprints dont start_date < cutoffDate", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint Old", "2024-01-10T00:00:00.000Z");
    seedSprint(2, "Sprint New", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1, 2] }]);
    const config = { ...TEST_CONFIG, cutoffDate: "2025-01-01" };
    const result = scopeChangeMetric.compute(createTestContext(db, config));
    expect(result.bySprint["Sprint Old"]).toBeUndefined();
    expect(result.bySprint["Sprint New"]).toBeDefined();
    expect(result.totalIssues).toBe(1);
  });

  it("exclut issue dont le sprint n'a pas de start_date", () => {
    seedIssue("PROJ-1");
    store.sprints.upsertMany([makeSprint({ id: 1, name: "Sprint Orphelin", state: "active", startDate: undefined, endDate: undefined, boardId: 1 })]);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint Orphelin", changedAt: "2025-03-01T00:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: "Avant", toValue: "Totalement différent et nouveau contenu complet entier", changedAt: "2025-03-15T10:00:00.000Z" },
    ]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.totalIssues).toBe(0);
  });
});

// ─── Règle 1 — changement trivial / significatif (champs texte) ─────────────

describe("Règle 1 — changements description/summary", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    // Assignation au sprint (première, from_value null)
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
    ]);
  });

  it("ignore changement trivial de description (espaces supplémentaires)", () => {
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: "Faire le module de login", toValue: "Faire  le module de login  ", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });

  it("ignore changement description si from_value est null (première saisie)", () => {
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: null, toValue: "Contenu initial très long", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });

  it("comptabilise changement de description significatif (paragraphe supprimé)", () => {
    const longText = "Critère 1 : le système doit valider les entrées. Critère 2 : afficher une erreur explicite. Critère 3 : logger toute tentative. Critère 4 : envoyer un email de confirmation.";
    const shortened = "Critère 1 : le système doit valider les entrées.";
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortened, changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-11T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(1);
    expect(result.bySprint["Sprint 42"]!.byChangeType.description).toBe(1);
  });

  it("comptabilise changement de summary significatif dans description", () => {
    const longSummary = "Implémenter la page de dashboard avec graphiques temps réel et export CSV";
    const shortSummary = "Dashboard";
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "summary", fromValue: longSummary, toValue: shortSummary, changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-11T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(1);
    expect(result.bySprint["Sprint 42"]!.byChangeType.description).toBe(1);
  });
});

// ─── Règle 2 — Story Points ──────────────────────────────────────────────────

describe("Règle 2 — Story Points", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
  });

  it("ignore première estimation (null → valeur)", () => {
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Story Points", fromValue: null, toValue: "3", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });

  it("ignore réévaluation Story Points (valeur → valeur)", () => {
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Story Points", fromValue: "3", toValue: "8", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });
});

// ─── Règle 3 — Périmètre temporel post-sprint-start ─────────────────────────

describe("Règle 3 — Périmètre temporel", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
  });

  it("ignore changement de description avant le sprint start", () => {
    const longText = "Critère détaillé pour tester le filtre temporel avec du contenu suffisant";
    const shortText = "Rien";
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-08T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });

  it("comptabilise changement significatif après le sprint start", () => {
    const longText = "Critère détaillé pour tester le filtre temporel avec du contenu suffisant";
    const shortText = "Rien";
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-11T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(1);
  });

  it("utilise le premier sprint (start_date le plus ancien) comme référence", () => {
    seedSprint(2, "Sprint 43", "2025-03-24T00:00:00.000Z");
    const longText = "Critère détaillé suffisamment long pour dépasser le seuil de similarité";
    const shortText = "Rien";
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        // Issue d'abord en Sprint 43, puis en Sprint 42 (plus ancien)
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 43", changedAt: "2025-03-01T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: "Sprint 43", toValue: "Sprint 42", changedAt: "2025-03-05T08:00:00.000Z" },
        // Changement de description le 2025-03-12 : après Sprint 42 start (2025-03-10), avant Sprint 43 start (2025-03-24)
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-12T10:00:00.000Z" },
      ],
    }]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-11T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    // Premier sprint = Sprint 42 (start 2025-03-10, plus ancien que Sprint 43)
    // Changement le 2025-03-12 > 2025-03-10 → comptabilisé
    expect(result.changedIssues).toBe(1);
    expect(result.totalIssues).toBe(1);
  });
});

// ─── Règle 4 — Reprogrammation sprint ────────────────────────────────────────

describe("Règle 4 — Sprint change", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    seedSprint(2, "Sprint 43", "2025-03-24T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
  });

  it("ignore assignation initiale (null → sprint)", () => {
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
    expect(result.totalIssues).toBe(1);
  });

  it("ignore reprogrammation sprint (sprint → sprint)", () => {
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: "Sprint 42", toValue: "Sprint 43", changedAt: "2025-03-15T12:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });
});

// ─── Agrégation bySprint et métriques globales ───────────────────────────────

describe("Agrégation bySprint", () => {
  it("compte correctement plusieurs issues dans le même sprint", () => {
    seedIssue("PROJ-1");
    seedIssue("PROJ-2");
    seedIssue("PROJ-3");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");

    const longText = "Texte initial très complet avec beaucoup de critères d'acceptation détaillés";
    const shortText = "Abrégé";

    store.issueSprints.replaceForIssues([
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [1] },
      { key: "PROJ-3", sprintIds: [1] },
    ]);

    // PROJ-1 : changement significatif
    store.issueFieldChanges.replaceForIssues([
      {
        key: "PROJ-1",
        rows: [
          { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-15T10:00:00.000Z" },
        ],
      },
      {
        key: "PROJ-2",
        rows: [
          { issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          { issueKey: "PROJ-2", fieldName: "Story Points", fromValue: "3", toValue: "8", changedAt: "2025-03-16T10:00:00.000Z" },
        ],
      },
      {
        key: "PROJ-3",
        rows: [
          { issueKey: "PROJ-3", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          // Pas de changement significatif
        ],
      },
    ]);

    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-11T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.totalIssues).toBe(3);
    expect(result.changedIssues).toBe(1);
    expect(result.changeRatio).toBeCloseTo(1 / 3);
    expect(result.bySprint["Sprint 42"]!.totalIssues).toBe(3);
    expect(result.bySprint["Sprint 42"]!.changedIssues).toBe(1);
    expect(result.bySprint["Sprint 42"]!.changeRatio).toBeCloseTo(1 / 3);
    expect(result.changedIssueKeys).toContain("PROJ-1");
    expect(result.changedIssueKeys).not.toContain("PROJ-2");
    expect(result.changedIssueKeys).not.toContain("PROJ-3");
  });

  it("sépare correctement les stats de deux sprints différents", () => {
    seedIssue("PROJ-1");
    seedIssue("PROJ-2");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    seedSprint(2, "Sprint 43", "2025-03-24T00:00:00.000Z");

    store.issueSprints.replaceForIssues([
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [2] },
    ]);
    store.issueFieldChanges.replaceForIssues([
      {
        key: "PROJ-1",
        rows: [
          { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          { issueKey: "PROJ-1", fieldName: "description", fromValue: "Critère complet avec beaucoup de détails et de spécifications nécessaires", toValue: "Abrégé", changedAt: "2025-03-15T10:00:00.000Z" },
        ],
      },
      {
        key: "PROJ-2",
        rows: [
          { issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 43", changedAt: "2025-03-23T08:00:00.000Z" },
        ],
      },
    ]);

    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-11T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.totalIssues).toBe(2);
    expect(Object.keys(result.bySprint)).toHaveLength(2);
    expect(result.bySprint["Sprint 42"]!.changedIssues).toBe(1);
    expect(result.bySprint["Sprint 43"]!.changedIssues).toBe(0);
    expect(result.bySprint["Sprint 43"]!.totalIssues).toBe(1);
  });
});

// ─── Règle 5 — Dénominateur depuis issue_sprints (ticket 034) ────────────────

describe("Règle 5 — Dénominateur depuis issue_sprints", () => {
  it("totalIssues compte les issues sans changelog Sprint (créées directement dans sprint)", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1" }), makeIssue({ key: "PROJ-2" })]);
    store.sprints.upsertMany([makeSprint({ id: 1, name: "Sprint 42", state: "active", startDate: "2025-03-10T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
    // PROJ-1 : créé directement dans sprint, aucun field change Sprint
    // PROJ-2 : a un field change Sprint
    store.issueSprints.replaceForIssues([
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [1] },
    ]);
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-2",
      rows: [{ issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" }],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.bySprint["Sprint 42"]!.totalIssues).toBe(2);
    expect(result.totalIssues).toBe(2);
  });

  it("retourne résultats vides si issue_sprints est vide (base non re-synchée)", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1" })]);
    store.sprints.upsertMany([makeSprint({ id: 1, name: "Sprint 42", state: "active", startDate: "2025-03-10T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [{ issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" }],
    }]);
    // issue_sprints non peuplé
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.totalIssues).toBe(0);
    expect(result.bySprint).toEqual({});
  });

  it("issue dans plusieurs sprints : totalIssues correct dans chaque sprint", () => {
    store.issues.upsertMany([makeIssue({ key: "PROJ-1" }), makeIssue({ key: "PROJ-2" })]);
    store.sprints.upsertMany([
      makeSprint({ id: 1, name: "Sprint 42", state: "closed", startDate: "2025-03-10T00:00:00.000Z", endDate: "2025-03-24T00:00:00.000Z", boardId: 1 }),
      makeSprint({ id: 2, name: "Sprint 43", state: "active", startDate: "2025-03-24T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 }),
    ]);
    // PROJ-1 dans les deux sprints (reprogrammé), PROJ-2 uniquement Sprint 43
    store.issueSprints.replaceForIssues([
      { key: "PROJ-1", sprintIds: [1, 2] },
      { key: "PROJ-2", sprintIds: [2] },
    ]);
    store.issueFieldChanges.replaceForIssues([{
      key: "PROJ-1",
      rows: [{ issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" }],
    }]);
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.bySprint["Sprint 42"]!.totalIssues).toBe(1);
    expect(result.bySprint["Sprint 43"]!.totalIssues).toBe(2);
    expect(result.totalIssues).toBe(3);
  });

  it("exclut les issue_types de excludeIssueTypes du dénominateur", () => {
    store.issues.upsertMany([
      makeIssue({ key: "PROJ-1", issueType: "Story" }),
      makeIssue({ key: "PROJ-2", issueType: "Epic" }),
    ]);
    store.sprints.upsertMany([makeSprint({ id: 1, name: "Sprint 42", state: "active", startDate: "2025-03-10T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
    store.issueSprints.replaceForIssues([
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [1] },
    ]);
    const config = { ...TEST_CONFIG, excludeIssueTypes: ["Epic"] };
    const result = scopeChangeMetric.compute(createTestContext(db, config));
    expect(result.bySprint["Sprint 42"]!.totalIssues).toBe(1);
  });
});

// ─── Règle 8 — Strip macros Jira dans normalizeText ─────────────────────────

describe("normalizeText — macros Jira", () => {
  it("supprime les macros Jira avec paramètres", () => {
    const a = normalizeText("{panel:title=Avant}Contenu identique{panel}");
    const b = normalizeText("{panel:title=Après}Contenu identique{panel}");
    expect(a).toBe(b);
  });

  it("supprime les macros Jira simples", () => {
    const a = normalizeText("{noformat}code ici{noformat}");
    const b = normalizeText("{code}code ici{code}");
    expect(a).toBe(b);
  });

  it("supprime les images inline", () => {
    const a = normalizeText("Voir !image-avant.png! pour détails");
    const b = normalizeText("Voir !image-après.png|thumbnail! pour détails");
    expect(a).toBe(b);
  });

  it("conserve le texte du lien Jira, supprime l'URL", () => {
    const a = normalizeText("Voir [ticket|https://jira.example.com/old]");
    const b = normalizeText("Voir [ticket|https://jira.example.com/new]");
    expect(a).toBe(b);
  });

  it("changement de contenu réel reste détectable après strip", () => {
    const sim = similarityRatio("{panel}Critère A{panel}", "{panel}Critère B complètement différent{panel}");
    expect(sim).toBeLessThan(0.85);
  });
});

// ─── Règle 9 — Dérive proportionnelle à l'original ──────────────────────────

describe("similarityRatio — dénominateur original", () => {
  it("petit ajout (10% de l'original) → sim 0.90, non détecté", () => {
    const from = "a".repeat(100);
    const to = "a".repeat(100) + "b".repeat(10);
    expect(similarityRatio(from, to)).toBeCloseTo(0.90);
    expect(similarityRatio(from, to)).toBeGreaterThanOrEqual(0.85);
  });

  it("gros ajout (30% de l'original) → sim 0.70, détecté", () => {
    const from = "a".repeat(100);
    const to = "a".repeat(100) + "b".repeat(30);
    expect(similarityRatio(from, to)).toBeCloseTo(0.70);
    expect(similarityRatio(from, to)).toBeLessThan(0.85);
  });

  it("suppression de contenu → sim < 1", () => {
    const sim = similarityRatio("Critère principal. Détails importants.", "Critère principal.");
    expect(sim).toBeLessThan(1);
  });

  it("réécriture complète → clampé à 0", () => {
    const sim = similarityRatio("a".repeat(100), "b".repeat(100));
    expect(sim).toBe(0);
  });
});

// ─── Règle 6 — First vs last (dérive cumulée) ───────────────────────────────

describe("scopeChangeMetric — Règle 6 first vs last", () => {
  it("détecte dérive cumulée : 3 changements chacun sim=0.9 mais first-vs-last sim=0.7", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    // a→b→c→d : chaque pas remplace 10 "a" par "x" → pairwise sim=0.9 > 0.85 (non détecté pairwise)
    // first "a"×100 vs last "x"×30+"a"×70 → lev=30, sim=0.7 < 0.85 → détecté first-vs-last
    const a = "a".repeat(100);
    const b = "x".repeat(10) + "a".repeat(90);
    const c = "x".repeat(20) + "a".repeat(80);
    const d = "x".repeat(30) + "a".repeat(70);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: a, toValue: b, changedAt: "2025-03-11T10:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: b, toValue: c, changedAt: "2025-03-12T10:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: c, toValue: d, changedAt: "2025-03-13T10:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-10T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(1);
  });

  it("n'alerte pas si delta cumulé first-vs-last reste sous le seuil (revert)", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    // Description change radicalement puis revient à l'état initial.
    // Pairwise : sim(v1,v2)=0 < 0.85 → ancien code détecte (faux positif).
    // First vs last : sim(v1,v3)=1.0 → pas de dérive réelle.
    const v1 = "a".repeat(100);
    const v2 = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: v1, toValue: v2, changedAt: "2025-03-11T10:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: v2, toValue: v1, changedAt: "2025-03-12T10:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-10T09:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });
});

// ─── Règle 7 — Grace period ──────────────────────────────────────────────────

describe("scopeChangeMetric — Règle 7 grace period", () => {
  it("ignore un changement dans la grace period (11h < 24h)", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    const from = "a".repeat(100);
    const to = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      // 11h après devStart → dans la grace period de 24h
      { issueKey: "PROJ-1", fieldName: "description", fromValue: from, toValue: to, changedAt: "2025-03-10T11:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-10T00:00:00.000Z" }]));
    const config = { ...TEST_CONFIG, scopeChangeGracePeriodHours: 24 };
    const result = scopeChangeMetric.compute(createTestContext(db, config));
    expect(result.changedIssues).toBe(0);
  });

  it("détecte un changement après la grace period (25h > 24h)", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    const from = "a".repeat(100);
    const to = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      // 25h après devStart → après la grace period de 24h
      { issueKey: "PROJ-1", fieldName: "description", fromValue: from, toValue: to, changedAt: "2025-03-11T01:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-10T00:00:00.000Z" }]));
    const config = { ...TEST_CONFIG, scopeChangeGracePeriodHours: 24 };
    const result = scopeChangeMetric.compute(createTestContext(db, config));
    expect(result.changedIssues).toBe(1);
  });

  it("grace period à 0 (absent) : comportement inchangé", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    const from = "a".repeat(100);
    const to = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      // 1h après devStart, sim=0 → détecté (pas de grace period)
      { issueKey: "PROJ-1", fieldName: "description", fromValue: from, toValue: to, changedAt: "2025-03-10T01:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-03-10T00:00:00.000Z" }]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(1);
  });
});

// ─── Règle 10 — Borne de détection = premier devStart ───────────────────────

describe("scopeChangeMetric — Règle 10 devStart comme borne de détection", () => {
  it("skip si aucune transition devStart (issue jamais démarrée)", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    const from = "a".repeat(100);
    const to = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: from, toValue: to, changedAt: "2025-03-15T10:00:00.000Z" },
    ]);
    // Pas de transition "In Progress" → devStart absent → skip détection
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
    expect(result.totalIssues).toBe(1); // reste dans le dénominateur
  });

  it("ignore changements post-sprint-start mais pré-devStart", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    const from = "a".repeat(100);
    const to = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      // Changement significatif entre sprint start (10 mars) et devStart (14 mars) → doit être ignoré
      { issueKey: "PROJ-1", fieldName: "description", fromValue: from, toValue: to, changedAt: "2025-03-12T10:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [
      { to: "In Progress", at: "2025-03-14T09:00:00.000Z" },
    ]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(0);
  });

  it("détecte changement post-devStart", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 1", "2025-03-10T00:00:00.000Z");
    store.issueSprints.replaceForIssues([{ key: "PROJ-1", sprintIds: [1] }]);
    const from = "a".repeat(100);
    const to = "b".repeat(100);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2025-03-09T12:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: from, toValue: to, changedAt: "2025-03-15T10:00:00.000Z" },
    ]);
    store.transitions.replaceForIssue("PROJ-1", makeTransitions("PROJ-1", [
      { to: "In Progress", at: "2025-03-14T09:00:00.000Z" },
    ]));
    const result = scopeChangeMetric.compute(createTestContext(db, TEST_CONFIG));
    expect(result.changedIssues).toBe(1);
  });
});

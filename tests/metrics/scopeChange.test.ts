import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, makeSprint, resetSeq, TEST_CONFIG } from "../helpers/seeders";
import { upsertIssues, upsertSprints, replaceAllFieldChanges, replaceAllIssueSprints } from "../../src/db/store";
import { scopeChangeMetric, normalizeText, similarityRatio } from "../../src/metrics/scopeChange";
import type Database from "better-sqlite3";
import type { FieldChange } from "../../src/jira/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

// Helpers locaux
function seedIssue(key: string) {
  upsertIssues(db, [makeIssue({ key })]);
}

function seedSprint(id: number, name: string, startDate: string) {
  upsertSprints(db, [makeSprint({ id, name, state: "active", startDate, endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
}

function seedFieldChanges(key: string, changes: FieldChange[]) {
  replaceAllFieldChanges(db, [{ key, changes }]);
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
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
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
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.totalIssues).toBe(0);
  });

  it("exclut sprints dont start_date < cutoffDate", () => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint Old", "2024-01-10T00:00:00.000Z");
    seedSprint(2, "Sprint New", "2025-03-10T00:00:00.000Z");
    replaceAllIssueSprints(db, [{ key: "PROJ-1", sprintIds: [1, 2] }]);
    const config = { ...TEST_CONFIG, cutoffDate: "2025-01-01" };
    const result = scopeChangeMetric.compute(db, config);
    expect(result.bySprint["Sprint Old"]).toBeUndefined();
    expect(result.bySprint["Sprint New"]).toBeDefined();
    expect(result.totalIssues).toBe(1);
  });

  it("exclut issue dont le sprint n'a pas de start_date", () => {
    seedIssue("PROJ-1");
    upsertSprints(db, [makeSprint({ id: 1, name: "Sprint Orphelin", state: "active", startDate: undefined, endDate: undefined, boardId: 1 })]);
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint Orphelin", changedAt: "2025-03-01T00:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "description", fromValue: "Avant", toValue: "Totalement différent et nouveau contenu complet entier", changedAt: "2025-03-15T10:00:00.000Z" },
    ]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.totalIssues).toBe(0);
  });
});

// ─── Règle 1 — changement trivial / significatif (champs texte) ─────────────

describe("Règle 1 — changements description/summary", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    replaceAllIssueSprints(db, [{ key: "PROJ-1", sprintIds: [1] }]);
    // Assignation au sprint (première, from_value null)
    seedFieldChanges("PROJ-1", [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
    ]);
  });

  it("ignore changement trivial de description (espaces supplémentaires)", () => {
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: "Faire le module de login", toValue: "Faire  le module de login  ", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(0);
  });

  it("ignore changement description si from_value est null (première saisie)", () => {
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: null, toValue: "Contenu initial très long", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(0);
  });

  it("comptabilise changement de description significatif (paragraphe supprimé)", () => {
    const longText = "Critère 1 : le système doit valider les entrées. Critère 2 : afficher une erreur explicite. Critère 3 : logger toute tentative. Critère 4 : envoyer un email de confirmation.";
    const shortened = "Critère 1 : le système doit valider les entrées.";
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortened, changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(1);
    expect(result.bySprint["Sprint 42"].byChangeType.description).toBe(1);
  });

  it("comptabilise changement de summary significatif dans description", () => {
    const longSummary = "Implémenter la page de dashboard avec graphiques temps réel et export CSV";
    const shortSummary = "Dashboard";
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "summary", fromValue: longSummary, toValue: shortSummary, changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(1);
    expect(result.bySprint["Sprint 42"].byChangeType.description).toBe(1);
  });
});

// ─── Règle 2 — Story Points ──────────────────────────────────────────────────

describe("Règle 2 — Story Points", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    replaceAllIssueSprints(db, [{ key: "PROJ-1", sprintIds: [1] }]);
  });

  it("ignore première estimation (null → valeur)", () => {
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Story Points", fromValue: null, toValue: "3", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(0);
  });

  it("ignore réévaluation Story Points (valeur → valeur)", () => {
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Story Points", fromValue: "3", toValue: "8", changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(0);
  });
});

// ─── Règle 3 — Périmètre temporel post-sprint-start ─────────────────────────

describe("Règle 3 — Périmètre temporel", () => {
  beforeEach(() => {
    seedIssue("PROJ-1");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    replaceAllIssueSprints(db, [{ key: "PROJ-1", sprintIds: [1] }]);
  });

  it("ignore changement de description avant le sprint start", () => {
    const longText = "Critère détaillé pour tester le filtre temporel avec du contenu suffisant";
    const shortText = "Rien";
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-08T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(0);
  });

  it("comptabilise changement significatif après le sprint start", () => {
    const longText = "Critère détaillé pour tester le filtre temporel avec du contenu suffisant";
    const shortText = "Rien";
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-15T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(1);
  });

  it("utilise le premier sprint (start_date le plus ancien) comme référence", () => {
    seedSprint(2, "Sprint 43", "2025-03-24T00:00:00.000Z");
    const longText = "Critère détaillé suffisamment long pour dépasser le seuil de similarité";
    const shortText = "Rien";
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        // Issue d'abord en Sprint 43, puis en Sprint 42 (plus ancien)
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 43", changedAt: "2025-03-01T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: "Sprint 43", toValue: "Sprint 42", changedAt: "2025-03-05T08:00:00.000Z" },
        // Changement de description le 2025-03-12 : après Sprint 42 start (2025-03-10), avant Sprint 43 start (2025-03-24)
        { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-12T10:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
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
    replaceAllIssueSprints(db, [{ key: "PROJ-1", sprintIds: [1] }]);
  });

  it("ignore assignation initiale (null → sprint)", () => {
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.changedIssues).toBe(0);
    expect(result.totalIssues).toBe(1);
  });

  it("ignore reprogrammation sprint (sprint → sprint)", () => {
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
        { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: "Sprint 42", toValue: "Sprint 43", changedAt: "2025-03-15T12:00:00.000Z" },
      ],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
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

    replaceAllIssueSprints(db, [
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [1] },
      { key: "PROJ-3", sprintIds: [1] },
    ]);

    // PROJ-1 : changement significatif
    replaceAllFieldChanges(db, [
      {
        key: "PROJ-1",
        changes: [
          { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          { issueKey: "PROJ-1", fieldName: "description", fromValue: longText, toValue: shortText, changedAt: "2025-03-15T10:00:00.000Z" },
        ],
      },
      {
        key: "PROJ-2",
        changes: [
          { issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          { issueKey: "PROJ-2", fieldName: "Story Points", fromValue: "3", toValue: "8", changedAt: "2025-03-16T10:00:00.000Z" },
        ],
      },
      {
        key: "PROJ-3",
        changes: [
          { issueKey: "PROJ-3", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          // Pas de changement significatif
        ],
      },
    ]);

    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.totalIssues).toBe(3);
    expect(result.changedIssues).toBe(1);
    expect(result.changeRatio).toBeCloseTo(1 / 3);
    expect(result.bySprint["Sprint 42"].totalIssues).toBe(3);
    expect(result.bySprint["Sprint 42"].changedIssues).toBe(1);
    expect(result.bySprint["Sprint 42"].changeRatio).toBeCloseTo(1 / 3);
    expect(result.changedIssueKeys).toContain("PROJ-1");
    expect(result.changedIssueKeys).not.toContain("PROJ-2");
    expect(result.changedIssueKeys).not.toContain("PROJ-3");
  });

  it("sépare correctement les stats de deux sprints différents", () => {
    seedIssue("PROJ-1");
    seedIssue("PROJ-2");
    seedSprint(1, "Sprint 42", "2025-03-10T00:00:00.000Z");
    seedSprint(2, "Sprint 43", "2025-03-24T00:00:00.000Z");

    replaceAllIssueSprints(db, [
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [2] },
    ]);
    replaceAllFieldChanges(db, [
      {
        key: "PROJ-1",
        changes: [
          { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" },
          { issueKey: "PROJ-1", fieldName: "description", fromValue: "Critère complet avec beaucoup de détails et de spécifications nécessaires", toValue: "Abrégé", changedAt: "2025-03-15T10:00:00.000Z" },
        ],
      },
      {
        key: "PROJ-2",
        changes: [
          { issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 43", changedAt: "2025-03-23T08:00:00.000Z" },
        ],
      },
    ]);

    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.totalIssues).toBe(2);
    expect(Object.keys(result.bySprint)).toHaveLength(2);
    expect(result.bySprint["Sprint 42"].changedIssues).toBe(1);
    expect(result.bySprint["Sprint 43"].changedIssues).toBe(0);
    expect(result.bySprint["Sprint 43"].totalIssues).toBe(1);
  });
});

// ─── Règle 5 — Dénominateur depuis issue_sprints (ticket 034) ────────────────

describe("Règle 5 — Dénominateur depuis issue_sprints", () => {
  it("totalIssues compte les issues sans changelog Sprint (créées directement dans sprint)", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" }), makeIssue({ key: "PROJ-2" })]);
    upsertSprints(db, [makeSprint({ id: 1, name: "Sprint 42", state: "active", startDate: "2025-03-10T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
    // PROJ-1 : créé directement dans sprint, aucun field change Sprint
    // PROJ-2 : a un field change Sprint
    replaceAllIssueSprints(db, [
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [1] },
    ]);
    replaceAllFieldChanges(db, [{
      key: "PROJ-2",
      changes: [{ issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" }],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.bySprint["Sprint 42"].totalIssues).toBe(2);
    expect(result.totalIssues).toBe(2);
  });

  it("retourne résultats vides si issue_sprints est vide (base non re-synchée)", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" })]);
    upsertSprints(db, [makeSprint({ id: 1, name: "Sprint 42", state: "active", startDate: "2025-03-10T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [{ issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" }],
    }]);
    // issue_sprints non peuplé
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.totalIssues).toBe(0);
    expect(result.bySprint).toEqual({});
  });

  it("issue dans plusieurs sprints : totalIssues correct dans chaque sprint", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" }), makeIssue({ key: "PROJ-2" })]);
    upsertSprints(db, [
      makeSprint({ id: 1, name: "Sprint 42", state: "closed", startDate: "2025-03-10T00:00:00.000Z", endDate: "2025-03-24T00:00:00.000Z", boardId: 1 }),
      makeSprint({ id: 2, name: "Sprint 43", state: "active", startDate: "2025-03-24T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 }),
    ]);
    // PROJ-1 dans les deux sprints (reprogrammé), PROJ-2 uniquement Sprint 43
    replaceAllIssueSprints(db, [
      { key: "PROJ-1", sprintIds: [1, 2] },
      { key: "PROJ-2", sprintIds: [2] },
    ]);
    replaceAllFieldChanges(db, [{
      key: "PROJ-1",
      changes: [{ issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2025-03-09T08:00:00.000Z" }],
    }]);
    const result = scopeChangeMetric.compute(db, TEST_CONFIG);
    expect(result.bySprint["Sprint 42"].totalIssues).toBe(1);
    expect(result.bySprint["Sprint 43"].totalIssues).toBe(2);
    expect(result.totalIssues).toBe(3);
  });

  it("exclut les issue_types de excludeIssueTypes du dénominateur", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1", issueType: "Story" }),
      makeIssue({ key: "PROJ-2", issueType: "Epic" }),
    ]);
    upsertSprints(db, [makeSprint({ id: 1, name: "Sprint 42", state: "active", startDate: "2025-03-10T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z", boardId: 1 })]);
    replaceAllIssueSprints(db, [
      { key: "PROJ-1", sprintIds: [1] },
      { key: "PROJ-2", sprintIds: [1] },
    ]);
    const config = { ...TEST_CONFIG, excludeIssueTypes: ["Epic"] };
    const result = scopeChangeMetric.compute(db, config);
    expect(result.bySprint["Sprint 42"].totalIssues).toBe(1);
  });
});

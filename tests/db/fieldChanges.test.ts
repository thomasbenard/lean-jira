import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { SqliteStore } from "../../src/store/sqlite";
import type Database from "better-sqlite3";
import { makeIssue, resetSeq } from "../helpers/seeders";
import type { FieldChange } from "../../src/jira/types";

let db: Database.Database;
let store: SqliteStore;
beforeEach(() => {
  db = createTestDb();
  store = new SqliteStore(db);
  resetSeq();
  store.issues.upsertMany([makeIssue({ key: "PROJ-1" }), makeIssue({ key: "PROJ-2" })]);
});

function getChanges(issueKey: string) {
  return db
    .prepare("SELECT field_name, from_value, to_value, changed_at FROM issue_field_changes WHERE issue_key = ? ORDER BY changed_at")
    .all(issueKey) as { field_name: string; from_value: string | null; to_value: string | null; changed_at: string }[];
}

describe("replaceAllFieldChanges", () => {
  it("insère des changements de champs en base", () => {
    const changes: FieldChange[] = [
      { issueKey: "PROJ-1", fieldName: "summary", fromValue: "Ancien titre", toValue: "Nouveau titre", changedAt: "2026-01-10T10:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-1", rows: changes }]);
    const rows = getChanges("PROJ-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].field_name).toBe("summary");
    expect(rows[0].from_value).toBe("Ancien titre");
    expect(rows[0].to_value).toBe("Nouveau titre");
  });

  it("stocke from_value null si première assignation", () => {
    const changes: FieldChange[] = [
      { issueKey: "PROJ-1", fieldName: "Sprint", fromValue: null, toValue: "Sprint 42", changedAt: "2026-01-05T08:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-1", rows: changes }]);
    const rows = getChanges("PROJ-1");
    expect(rows[0].from_value).toBeNull();
    expect(rows[0].to_value).toBe("Sprint 42");
  });

  it("stocke to_value null si suppression d'un champ", () => {
    const changes: FieldChange[] = [
      { issueKey: "PROJ-1", fieldName: "description", fromValue: "Une description", toValue: null, changedAt: "2026-01-05T08:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-1", rows: changes }]);
    const rows = getChanges("PROJ-1");
    expect(rows[0].to_value).toBeNull();
  });

  it("remplace intégralement les changements existants pour l'issue", () => {
    const ancien: FieldChange[] = [
      { issueKey: "PROJ-1", fieldName: "summary", fromValue: "V1", toValue: "V2", changedAt: "2026-01-01T00:00:00.000Z" },
      { issueKey: "PROJ-1", fieldName: "summary", fromValue: "V2", toValue: "V3", changedAt: "2026-01-02T00:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-1", rows: ancien }]);
    expect(getChanges("PROJ-1")).toHaveLength(2);

    const nouveau: FieldChange[] = [
      { issueKey: "PROJ-1", fieldName: "description", fromValue: null, toValue: "Contenu", changedAt: "2026-01-03T00:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-1", rows: nouveau }]);
    const rows = getChanges("PROJ-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].field_name).toBe("description");
  });

  it("ne touche pas les données des issues non-incluses", () => {
    const changesProj1: FieldChange[] = [
      { issueKey: "PROJ-1", fieldName: "summary", fromValue: "A", toValue: "B", changedAt: "2026-01-01T00:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-1", rows: changesProj1 }]);

    const changesProj2: FieldChange[] = [
      { issueKey: "PROJ-2", fieldName: "Sprint", fromValue: null, toValue: "Sprint 1", changedAt: "2026-01-01T00:00:00.000Z" },
    ];
    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-2", rows: changesProj2 }]);

    store.issueFieldChanges.replaceForIssues([{ key: "PROJ-2", rows: [] }]);
    expect(getChanges("PROJ-1")).toHaveLength(1);
  });

  it("gère une liste vide sans erreur", () => {
    expect(() => store.issueFieldChanges.replaceForIssues([])).not.toThrow();
    expect(getChanges("PROJ-1")).toHaveLength(0);
  });
});

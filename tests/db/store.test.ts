import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { upsertIssues, upsertSprints, upsertStatuses, replaceTransitions, getDoneStatusNames, getAllStatuses, logSync, getLastSyncDate } from "../../src/db/store";
import type Database from "better-sqlite3";
import { makeIssue, makeSprint, makeTransitions, resetSeq } from "../helpers/seeders";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

describe("upsertIssues", () => {
  it("insère une nouvelle issue", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" })]);
    const row = db.prepare("SELECT key, issue_type FROM issues WHERE key = 'PROJ-1'").get() as { key: string; issue_type: string };
    expect(row.key).toBe("PROJ-1");
    expect(row.issue_type).toBe("Story");
  });

  it("met à jour summary et current_status sur conflit de clé", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", summary: "Avant", currentStatus: "To Do" })]);
    upsertIssues(db, [makeIssue({ key: "PROJ-1", summary: "Après", currentStatus: "Done" })]);
    const row = db.prepare("SELECT summary, current_status FROM issues WHERE key = 'PROJ-1'").get() as { summary: string; current_status: string };
    expect(row.summary).toBe("Après");
    expect(row.current_status).toBe("Done");
  });

  it("insère plusieurs issues en transaction", () => {
    upsertIssues(db, [
      makeIssue({ key: "PROJ-1" }),
      makeIssue({ key: "PROJ-2" }),
      makeIssue({ key: "PROJ-3" }),
    ]);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM issues").get() as { c: number }).c;
    expect(count).toBe(3);
  });

  it("resolved_at peut être null", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1", resolvedAt: null })]);
    const row = db.prepare("SELECT resolved_at FROM issues WHERE key = 'PROJ-1'").get() as { resolved_at: string | null };
    expect(row.resolved_at).toBeNull();
  });
});

describe("upsertSprints", () => {
  it("insère un nouveau sprint", () => {
    upsertSprints(db, [makeSprint({ id: 10, name: "Sprint A" })]);
    const row = db.prepare("SELECT id, name FROM sprints WHERE id = 10").get() as { id: number; name: string };
    expect(row.id).toBe(10);
    expect(row.name).toBe("Sprint A");
  });

  it("met à jour state et name sur conflit d'id", () => {
    upsertSprints(db, [makeSprint({ id: 10, name: "Ancien", state: "future" })]);
    upsertSprints(db, [makeSprint({ id: 10, name: "Nouveau", state: "active" })]);
    const row = db.prepare("SELECT name, state FROM sprints WHERE id = 10").get() as { name: string; state: string };
    expect(row.name).toBe("Nouveau");
    expect(row.state).toBe("active");
  });
});

describe("replaceTransitions", () => {
  it("insère des transitions pour une issue", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" })]);
    replaceTransitions(db, "PROJ-1", makeTransitions("PROJ-1", [
      { to: "In Progress", at: "2025-01-06T09:00:00Z" },
      { to: "Done", at: "2025-01-07T09:00:00Z" },
    ]));
    const count = (db.prepare("SELECT COUNT(*) AS c FROM transitions WHERE issue_key = 'PROJ-1'").get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it("remplace les transitions existantes pour la même issue", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" })]);
    replaceTransitions(db, "PROJ-1", makeTransitions("PROJ-1", [
      { to: "In Progress", at: "2025-01-06T09:00:00Z" },
    ]));
    replaceTransitions(db, "PROJ-1", makeTransitions("PROJ-1", [
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done", at: "2025-01-10T09:00:00Z" },
    ]));
    const rows = db.prepare("SELECT to_status FROM transitions WHERE issue_key = 'PROJ-1' ORDER BY transitioned_at").all() as Array<{ to_status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].to_status).toBe("In Progress");
    expect(rows[1].to_status).toBe("Done");
  });

  it("n'affecte pas les transitions d'une autre issue", () => {
    upsertIssues(db, [makeIssue({ key: "PROJ-1" }), makeIssue({ key: "PROJ-2" })]);
    replaceTransitions(db, "PROJ-1", makeTransitions("PROJ-1", [{ to: "In Progress", at: "2025-01-06T09:00:00Z" }]));
    replaceTransitions(db, "PROJ-2", makeTransitions("PROJ-2", [{ to: "Done", at: "2025-01-07T09:00:00Z" }]));
    replaceTransitions(db, "PROJ-1", []);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM transitions WHERE issue_key = 'PROJ-2'").get() as { c: number }).c;
    expect(count).toBe(1);
  });
});

describe("upsertStatuses", () => {
  it("insère un nouveau statut", () => {
    upsertStatuses(db, [{ name: "Done", categoryKey: "done", categoryName: "Done" }]);
    const row = db.prepare("SELECT category_key FROM statuses WHERE name = 'Done'").get() as { category_key: string };
    expect(row.category_key).toBe("done");
  });

  it("met à jour category_key sur conflit de name", () => {
    upsertStatuses(db, [{ name: "À valider", categoryKey: "indeterminate", categoryName: "In Progress" }]);
    upsertStatuses(db, [{ name: "À valider", categoryKey: "done", categoryName: "Done" }]);
    const row = db.prepare("SELECT category_key FROM statuses WHERE name = 'À valider'").get() as { category_key: string };
    expect(row.category_key).toBe("done");
  });
});

describe("getDoneStatusNames", () => {
  it("retourne seulement les statuts category_key='done'", () => {
    upsertStatuses(db, [
      { name: "Done", categoryKey: "done", categoryName: "Done" },
      { name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" },
      { name: "To Do", categoryKey: "new", categoryName: "New" },
    ]);
    const names = getDoneStatusNames(db);
    expect(names.has("Done")).toBe(true);
    expect(names.has("In Progress")).toBe(false);
    expect(names.has("To Do")).toBe(false);
  });

  it("retourne un Set vide si aucun statut done", () => {
    const names = getDoneStatusNames(db);
    expect(names.size).toBe(0);
  });

  it("retourne un Set (pas un Array)", () => {
    upsertStatuses(db, [{ name: "Done", categoryKey: "done", categoryName: "Done" }]);
    const result = getDoneStatusNames(db);
    expect(result instanceof Set).toBe(true);
  });
});

describe("getAllStatuses", () => {
  it("retourne une liste vide si aucun statut en base", () => {
    expect(getAllStatuses(db)).toEqual([]);
  });

  it("retourne tous les statuts avec name et categoryKey", () => {
    upsertStatuses(db, [
      { name: "Done", categoryKey: "done", categoryName: "Done" },
      { name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" },
    ]);
    const result = getAllStatuses(db);
    expect(result).toHaveLength(2);
    expect(result.some((s) => s.name === "Done" && s.categoryKey === "done")).toBe(true);
    expect(result.some((s) => s.name === "In Progress" && s.categoryKey === "indeterminate")).toBe(true);
  });

  it("retourne les statuts triés par nom", () => {
    upsertStatuses(db, [
      { name: "Zorro", categoryKey: "new", categoryName: "New" },
      { name: "Alpha", categoryKey: "done", categoryName: "Done" },
    ]);
    const result = getAllStatuses(db);
    expect(result[0].name).toBe("Alpha");
    expect(result[1].name).toBe("Zorro");
  });
});

describe("logSync", () => {
  it("insère une ligne avec project_key et issues_count", () => {
    logSync(db, "KECK", 42);
    const row = db.prepare("SELECT project_key, issues_count FROM sync_log").get() as { project_key: string; issues_count: number };
    expect(row.project_key).toBe("KECK");
    expect(row.issues_count).toBe(42);
  });

  it("plusieurs appels OK (autoincrement, pas de PK conflict)", () => {
    logSync(db, "KECK", 10);
    logSync(db, "KECK", 20);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM sync_log").get() as { c: number }).c;
    expect(count).toBe(2);
  });
});

describe("getLastSyncDate", () => {
  it("retourne null si sync_log est vide", () => {
    expect(getLastSyncDate(db, "KECK")).toBeNull();
  });

  it("retourne le synced_at du dernier sync pour le project_key donné", () => {
    db.prepare("INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)").run("2026-04-20T10:00:00.000Z", 10, "KECK");
    db.prepare("INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)").run("2026-04-28T10:30:00.000Z", 20, "KECK");
    expect(getLastSyncDate(db, "KECK")).toBe("2026-04-28T10:30:00.000Z");
  });

  it("filtre par project_key — retourne null si seul l'autre projet a des syncs", () => {
    db.prepare("INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)").run("2026-04-29T09:00:00.000Z", 5, "AUTRE");
    expect(getLastSyncDate(db, "PROJ")).toBeNull();
  });

  it("filtre par project_key — retourne le bon sync parmi plusieurs projets", () => {
    db.prepare("INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)").run("2026-04-29T09:00:00.000Z", 5, "AUTRE");
    db.prepare("INSERT INTO sync_log (synced_at, issues_count, project_key) VALUES (?, ?, ?)").run("2026-04-01T08:00:00.000Z", 3, "PROJ");
    expect(getLastSyncDate(db, "PROJ")).toBe("2026-04-01T08:00:00.000Z");
  });
});

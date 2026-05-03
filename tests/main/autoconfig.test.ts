import { describe, it, expect, beforeEach } from "vitest";
import type { JiraBoardConfig, JiraStatus } from "../../src/jira/types";
import { createTestDb } from "../helpers/db";
import { upsertIssues, replaceTransitions } from "../../src/db/store";
import { makeIssue, makeTransitions, resetSeq } from "../helpers/seeders";
import type Database from "better-sqlite3";

import { inferBoardColumns, renderBoardColumnsYaml, enrichWithLegacyStatuses } from "../../src/main";

function makeStatus(id: string, name: string, categoryKey: "new" | "indeterminate" | "done"): JiraStatus {
  return { id, name, statusCategory: { key: categoryKey, name: categoryKey } };
}

function makeBoard(columnNames: string[], statusIds: string[][]): JiraBoardConfig {
  return {
    id: 1,
    name: "TEST",
    columnConfig: {
      columns: columnNames.map((name, i) => ({
        name,
        statuses: (statusIds[i] ?? []).map((id) => ({ id, self: "" })),
      })),
    },
  };
}

const defaultStatuses: JiraStatus[] = [
  makeStatus("1", "À faire", "new"),
  makeStatus("2", "En cours", "indeterminate"),
  makeStatus("3", "Review", "indeterminate"),
  makeStatus("4", "Terminé", "done"),
];

describe("inferBoardColumns — règle 1 : inférence par position", () => {
  it("board à 4 colonnes : première=todo, dernière=done, intermédiaires=active", () => {
    const board = makeBoard(["Backlog", "En cours", "Review", "Terminé"], [["1"], ["2"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[0].type).toBe("todo");
    expect(cols[3].type).toBe("done");
    expect(cols[1].type).toBe("active");
    expect(cols[2].type).toBe("active");
  });

  it("board à 2 colonnes : première=todo, dernière=done, pas de devStart", () => {
    const board = makeBoard(["À faire", "Terminé"], [["1"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[0].type).toBe("todo");
    expect(cols[1].type).toBe("done");
    expect(cols.every((c) => !c.devStart)).toBe(true);
  });

  it("board à 1 colonne : type=todo", () => {
    const board = makeBoard(["Tout"], [["1"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[0].type).toBe("todo");
  });
});

describe("inferBoardColumns — règle 2 : devStart", () => {
  it("devStart=true uniquement sur première colonne intermédiaire", () => {
    const board = makeBoard(["Todo", "Col-A", "Col-B", "Done"], [["1"], ["2"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].devStart).toBe(true);
    expect(cols[2].devStart).toBeFalsy();
  });

  it("aucun devStart si pas de colonne intermédiaire (2 colonnes)", () => {
    const board = makeBoard(["À faire", "Terminé"], [["1"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols.every((c) => !c.devStart)).toBe(true);
  });
});

describe("inferBoardColumns — règle 3 : avertissement catégorie done", () => {
  it("colonne intermédiaire avec tous statuts catégorie done → type reste active, warning présent", () => {
    const statuses = [
      makeStatus("1", "Todo", "new"),
      makeStatus("2", "À valider", "done"),
      makeStatus("5", "Validé", "done"),
      makeStatus("4", "Terminé", "done"),
    ];
    const board = makeBoard(["Todo", "À valider", "Done"], [["1"], ["2", "5"], ["4"]]);
    const cols = inferBoardColumns(board, statuses);
    expect(cols[1].type).toBe("active");
    expect(cols[1].warning).toMatch(/done/);
  });

  it("colonne intermédiaire avec statuts indeterminate → pas de warning", () => {
    const board = makeBoard(["Todo", "Review", "Done"], [["1"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].warning).toBeUndefined();
  });
});

describe("inferBoardColumns — règle 4 : ID non résolu", () => {
  it("status ID absent des statuts Jira → inclus comme '# ID:999 non résolu'", () => {
    const board = makeBoard(["Todo", "Mystère", "Done"], [["1"], ["999"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].statuses).toContain("# ID:999 non résolu");
  });
});

describe("renderBoardColumnsYaml", () => {
  it("génère un YAML valide avec board: et columns:", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const yaml = renderBoardColumnsYaml(cols);
    expect(yaml).toContain("board:");
    expect(yaml).toContain("columns:");
    expect(yaml).toContain('"Todo"');
    expect(yaml).toContain("type: todo");
    expect(yaml).toContain("devStart: true");
  });

  it("colonne vide → statuses: [] avec commentaire", () => {
    const board = makeBoard(["Todo", "Vide", "Done"], [["1"], [], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const out = renderBoardColumnsYaml(cols);
    expect(out).toContain("statuses: []");
  });

  it("rend legacyStatuses par colonne si présents", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    cols[0].legacyStatuses = ["Ready to do", "To Do"];
    const out = renderBoardColumnsYaml(cols);
    expect(out).toContain("legacyStatuses:");
    expect(out).toContain('"Ready to do"');
    expect(out).toContain('"To Do"');
  });

  it("rend legacyDoneStatuses au niveau board si fournis", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const out = renderBoardColumnsYaml(cols, ["Delivred", "DELIVERED"]);
    expect(out).toContain("legacyDoneStatuses:");
    expect(out).toContain('"Delivred"');
    expect(out).toContain('"DELIVERED"');
  });

  it("n'affiche pas legacyDoneStatuses si tableau vide", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const out = renderBoardColumnsYaml(cols, []);
    expect(out).not.toContain("legacyDoneStatuses:");
  });
});

describe("enrichWithLegacyStatuses", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    resetSeq();
  });

  function seedTransition(issueKey: string, toStatus: string, at: string): void {
    upsertIssues(db, [makeIssue({ key: issueKey })]);
    replaceTransitions(db, issueKey, makeTransitions(issueKey, [{ to: toStatus, at }]));
  }

  it("statut en DB catégorie new, absent du board → legacyStatuses du todo column", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    // "Ready to do" est dans allStatuses (catégorie new, id=10) mais pas dans boardConfig
    const allStatuses = [...defaultStatuses, makeStatus("10", "Ready to do", "new")];
    seedTransition("PROJ-1", "Ready to do", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(cols[0].legacyStatuses).toContain("Ready to do");
    expect(result.legacyDoneStatuses).not.toContain("Ready to do");
    expect(result.unresolvable).not.toContain("Ready to do");
  });

  it("statut en DB catégorie done, absent du board → legacyDoneStatuses", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const allStatuses = [...defaultStatuses, makeStatus("10", "Delivred", "done")];
    seedTransition("PROJ-1", "Delivred", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(result.legacyDoneStatuses).toContain("Delivred");
    expect(result.unresolvable).not.toContain("Delivred");
  });

  it("statut en DB catégorie indeterminate, absent du board → unresolvable", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const allStatuses = [...defaultStatuses, makeStatus("10", "Ancien WIP", "indeterminate")];
    seedTransition("PROJ-1", "Ancien WIP", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(result.unresolvable).toContain("Ancien WIP");
  });

  it("statut en DB absent de allStatuses (renommé/supprimé Jira) → unresolvable", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    seedTransition("PROJ-1", "Statut fantôme", "2026-01-01T09:00:00Z");
    // "Statut fantôme" absent de defaultStatuses
    const result = enrichWithLegacyStatuses(cols, board, defaultStatuses, db);
    expect(result.unresolvable).toContain("Statut fantôme");
  });

  it("statut déjà dans currentNames → ignoré", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    // "En cours" est déjà dans la colonne courante
    seedTransition("PROJ-1", "En cours", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, defaultStatuses, db);
    expect(result.unresolvable).not.toContain("En cours");
    expect(cols[0].legacyStatuses ?? []).not.toContain("En cours");
  });

  it("scan full history : statut antérieur à toute date détecté", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const allStatuses = [...defaultStatuses, makeStatus("10", "Ancien", "new")];
    seedTransition("PROJ-1", "Ancien", "2024-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(cols[0].legacyStatuses).toContain("Ancien");
    expect(result.unresolvable).not.toContain("Ancien");
  });
});

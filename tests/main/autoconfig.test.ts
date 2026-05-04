import { describe, it, expect, beforeEach } from "vitest";
import type { JiraBoardConfig, JiraStatus } from "../../src/jira/types";
import { createTestDb } from "../helpers/db";
import { upsertIssues, replaceTransitions } from "../../src/db/store";
import { makeIssue, makeTransitions, resetSeq } from "../helpers/seeders";
import type Database from "better-sqlite3";

import {
  inferBoardColumns,
  renderBoardColumnsYaml,
  enrichWithLegacyStatuses,
  mergeColumns,
  buildUnresolvableComment,
} from "../../src/main";
import type { BoardColumn, InferredColumn } from "../../src/main";

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
  it("board à 4 colonnes : première=todo, dernière=done, intermédiaires inférées par position/keywords", () => {
    // "En cours" = active (pas de keyword), "Review" = queue (keyword "review")
    const board = makeBoard(["Backlog", "En cours", "Review", "Terminé"], [["1"], ["2"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[0].type).toBe("todo");
    expect(cols[3].type).toBe("done");
    expect(cols[1].type).toBe("active");
    expect(cols[2].type).toBe("queue");
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
  it("colonne intermédiaire avec tous statuts catégorie done → warning présent (type selon keywords)", () => {
    // "Accepté" = pas de keyword → type active ; warning car statuts catégorie done
    const statuses = [
      makeStatus("1", "Todo", "new"),
      makeStatus("2", "Accepté", "done"),
      makeStatus("5", "Validé", "done"),
      makeStatus("4", "Terminé", "done"),
    ];
    const board = makeBoard(["Todo", "Accepté", "Done"], [["1"], ["2", "5"], ["4"]]);
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

describe("buildUnresolvableComment", () => {
  it("liste vide → chaîne vide", () => {
    expect(buildUnresolvableComment([])).toBe("");
  });

  it("contient chaque nom comme ligne de commentaire YAML", () => {
    const out = buildUnresolvableComment(["Ancien WIP", "Statut fantôme"]);
    expect(out).toContain('"Ancien WIP"');
    expect(out).toContain('"Statut fantôme"');
    expect(out.split("\n").every((l) => l === "" || l.startsWith("#"))).toBe(true);
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

  it("legacyStatuses sur colonne done rendus dans YAML", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    cols[2].legacyStatuses = ["Delivred", "DELIVERED"];
    const out = renderBoardColumnsYaml(cols);
    expect(out).toContain('"Delivred"');
    expect(out).toContain('"DELIVERED"');
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
    const allStatuses = [...defaultStatuses, makeStatus("10", "Ready to do", "new")];
    seedTransition("PROJ-1", "Ready to do", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(cols[0].legacyStatuses).toContain("Ready to do");
    expect(result.unresolvable).not.toContain("Ready to do");
  });

  it("statut en DB catégorie done, absent du board → legacyStatuses de la colonne done", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const allStatuses = [...defaultStatuses, makeStatus("10", "Delivred", "done")];
    seedTransition("PROJ-1", "Delivred", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(cols[2].legacyStatuses).toContain("Delivred");
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

  it("statut déjà dans legacyStatuses d'une colonne → ignoré, pas de warning unresolvable", () => {
    const board = makeBoard(["Todo", "En cours", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    // "À réaliser" déjà géré dans legacyStatuses de la config existante (catégorie indeterminate → serait unresolvable sinon)
    cols[1].legacyStatuses = ["À réaliser"];
    const allStatuses = [...defaultStatuses, makeStatus("10", "À réaliser", "indeterminate")];
    seedTransition("PROJ-1", "À réaliser", "2026-01-01T09:00:00Z");
    const result = enrichWithLegacyStatuses(cols, board, allStatuses, db);
    expect(result.unresolvable).not.toContain("À réaliser");
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

describe("inferBoardColumns — règle 5 : inférence queue par mots-clés", () => {
  it("colonne intermédiaire nommée 'Code Review' → type queue, queueKeyword = 'review'", () => {
    const board = makeBoard(["Todo", "Code Review", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].type).toBe("queue");
    expect(cols[1].queueKeyword).toBe("review");
  });

  it("match insensible à la casse : 'VALIDATION CLIENT' → queue, queueKeyword = 'validation'", () => {
    const board = makeBoard(["Todo", "VALIDATION CLIENT", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].type).toBe("queue");
    expect(cols[1].queueKeyword).toBe("validation");
  });

  it("pas de mot-clé : 'Développement' → active, queueKeyword undefined", () => {
    const board = makeBoard(["Todo", "Développement", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].type).toBe("active");
    expect(cols[1].queueKeyword).toBeUndefined();
  });

  it("première colonne intermédiaire queue → devStart sur la suivante colonne active", () => {
    const board = makeBoard(["Todo", "Review", "Développement", "Done"], [["1"], ["2"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].type).toBe("queue");
    expect(cols[1].devStart).toBeFalsy();
    expect(cols[2].type).toBe("active");
    expect(cols[2].devStart).toBe(true);
  });

  it("toutes colonnes intermédiaires queue → aucun devStart", () => {
    const board = makeBoard(["Todo", "Review", "Validation", "Done"], [["1"], ["2"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols.every((c) => !c.devStart)).toBe(true);
  });

  it("plusieurs mots-clés dans le nom : 'QA Review' → premier match dans QUEUE_KEYWORDS = 'review'", () => {
    const board = makeBoard(["Todo", "QA Review", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].type).toBe("queue");
    expect(cols[1].queueKeyword).toBe("review");
  });

  it("nom vide → pas de match, type active", () => {
    const board = makeBoard(["Todo", "", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    expect(cols[1].type).toBe("active");
    expect(cols[1].queueKeyword).toBeUndefined();
  });
});

describe("renderBoardColumnsYaml — commentaire inline pour queue inféré par mot-clé", () => {
  it("colonne queue inférée par mot-clé → commentaire '# inféré depuis le mot-clé X — vérifier'", () => {
    const board = makeBoard(["Todo", "Code Review", "Done"], [["1"], ["2"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const yaml = renderBoardColumnsYaml(cols);
    expect(yaml).toContain('# inféré depuis le mot-clé "review" — vérifier');
  });

  it("colonne active sans mot-clé (non-devStart) → commentaire '# changer en queue si temps d\\'attente' inchangé", () => {
    // deuxième colonne intermédiaire : pas devStart, pas de keyword → commentaire aide doit apparaître
    const board = makeBoard(["Todo", "Dev", "Recette", "Done"], [["1"], ["2"], ["3"], ["4"]]);
    const cols = inferBoardColumns(board, defaultStatuses);
    const yaml = renderBoardColumnsYaml(cols);
    expect(yaml).toContain('# changer en "queue" si temps d\'attente');
  });
});

describe("mergeColumns — règle 5b : queueKeyword supprimé pour colonnes préexistantes", () => {
  it("colonne déjà en config → queueKeyword absent après merge même si keyword matche", () => {
    const existing: BoardColumn[] = [{ name: "Code Review", type: "queue", statuses: [] }];
    const inferred: InferredColumn[] = [{ name: "Code Review", type: "queue", queueKeyword: "review", statuses: ["À revoir"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].queueKeyword).toBeUndefined();
  });

  it("nouvelle colonne (absente config) → queueKeyword conservé", () => {
    const existing: BoardColumn[] = [];
    const inferred: InferredColumn[] = [{ name: "Code Review", type: "queue", queueKeyword: "review", statuses: ["À revoir"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].queueKeyword).toBe("review");
  });
});

describe("mergeColumns — règle 1 : préservation des personnalisations", () => {
  it("type personnalisé préservé après merge", () => {
    const existing: BoardColumn[] = [{ name: "STANDBY", type: "queue", statuses: ["Anciens statuts"] }];
    const inferred: InferredColumn[] = [{ name: "STANDBY", type: "active", statuses: ["En attente"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].type).toBe("queue");
    expect(columns[0].statuses).toEqual(["En attente"]);
  });

  it("devStart préservé après merge", () => {
    const existing: BoardColumn[] = [{ name: "IN PROGRESS", type: "active", devStart: true, statuses: [] }];
    const inferred: InferredColumn[] = [{ name: "IN PROGRESS", type: "active", devStart: false, statuses: ["En cours"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].devStart).toBe(true);
  });

  it("legacyStatuses préservés après merge, statuses mis à jour depuis l'API", () => {
    const existing: BoardColumn[] = [
      { name: "TODO", type: "todo", statuses: ["Old status"], legacyStatuses: ["Ready to do", "To Do"] },
    ];
    const inferred: InferredColumn[] = [{ name: "TODO", type: "todo", statuses: ["Prêt à faire"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].legacyStatuses).toEqual(["Ready to do", "To Do"]);
    expect(columns[0].statuses).toEqual(["Prêt à faire"]);
  });
});

describe("mergeColumns — règle 2 : nouvelle colonne dans l'API absente du config", () => {
  it("nouvelle colonne inférée et ajoutée au résultat", () => {
    const existing: BoardColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "IN PROGRESS", type: "active", statuses: [] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const inferred: InferredColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "IN PROGRESS", type: "active", statuses: [] },
      { name: "TEST QA", type: "active", statuses: ["Test"] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns.some((c) => c.name === "TEST QA")).toBe(true);
    expect(columns.find((c) => c.name === "TEST QA")?.type).toBe("active");
  });

  it("warning retourné pour nouvelle colonne absente du config existant", () => {
    const existing: BoardColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const inferred: InferredColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "IN PROGRESS", type: "active", statuses: [] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const { warnings } = mergeColumns(existing, inferred);
    expect(warnings.some((w) => w.includes("Nouvelle colonne détectée") && w.includes("IN PROGRESS"))).toBe(true);
  });
});

describe("mergeColumns — règle 4 : aucune config existante (existing vide)", () => {
  it("existing vide → toutes colonnes inférées passent telles quelles, aucun warning absent", () => {
    const inferred: InferredColumn[] = [
      { name: "TODO", type: "todo", statuses: ["À faire"] },
      { name: "IN PROGRESS", type: "active", devStart: true, statuses: ["En cours"] },
      { name: "DONE", type: "done", statuses: ["Terminé"] },
    ];
    const { columns, warnings } = mergeColumns([], inferred);
    expect(columns).toHaveLength(3);
    expect(columns[0].type).toBe("todo");
    expect(columns[1].devStart).toBe(true);
    expect(warnings.some((w) => w.includes("absente du board Jira"))).toBe(false);
  });
});

describe("mergeColumns — règle 3 : colonne config absente de l'API", () => {
  it("colonne config orpheline conservée, warning retourné", () => {
    const existing: BoardColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "DESIGN", type: "active", statuses: ["Design"] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const inferred: InferredColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const { columns, warnings } = mergeColumns(existing, inferred);
    expect(columns.some((c) => c.name === "DESIGN")).toBe(true);
    expect(warnings.some((w) => w.includes("absente du board Jira") && w.includes("DESIGN"))).toBe(true);
  });

  it("colonnes API et config complètement disjointes : 3 warnings new + 3 warnings absentes", () => {
    const existing: BoardColumn[] = [
      { name: "TODO", type: "todo", statuses: [] },
      { name: "IN PROGRESS", type: "active", statuses: [] },
      { name: "DONE", type: "done", statuses: [] },
    ];
    const inferred: InferredColumn[] = [
      { name: "BACKLOG", type: "todo", statuses: [] },
      { name: "EN COURS", type: "active", statuses: [] },
      { name: "TERMINÉ", type: "done", statuses: [] },
    ];
    const { warnings } = mergeColumns(existing, inferred);
    expect(warnings.filter((w) => w.includes("Nouvelle colonne détectée"))).toHaveLength(3);
    expect(warnings.filter((w) => w.includes("absente du board Jira"))).toHaveLength(3);
  });
});

describe("mergeColumns — préservation du champ role", () => {
  it("role préservé depuis la config existante après merge", () => {
    const existing: BoardColumn[] = [{ name: "Dev", type: "active", role: "dev", statuses: [] }];
    const inferred: InferredColumn[] = [{ name: "Dev", type: "active", statuses: ["En dev"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].role).toBe("dev");
  });

  it("nouvelle colonne sans role → role absent après merge", () => {
    const existing: BoardColumn[] = [];
    const inferred: InferredColumn[] = [{ name: "QA", type: "active", statuses: ["En test"] }];
    const { columns } = mergeColumns(existing, inferred);
    expect(columns[0].role).toBeUndefined();
  });
});

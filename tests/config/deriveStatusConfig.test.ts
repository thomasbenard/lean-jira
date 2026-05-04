import { describe, it, expect } from "vitest";
import { deriveStatusConfig } from "../../src/main";
import type { BoardConfig } from "../../src/main";

describe("deriveStatusConfig", () => {
  it("dérive toutes les listes depuis une config complète", () => {
    const board: BoardConfig = {
      columns: [
        { name: "À faire", type: "todo", statuses: ["Prêt à faire", "Ready to do"] },
        { name: "Dev", type: "active", devStart: true, statuses: ["Dev en cours", "En attente"] },
        { name: "Review", type: "queue", statuses: ["À revoir", "Reviewed"] },
        { name: "Done", type: "done", statuses: ["Livré"] },
      ],
      legacyDoneStatuses: ["Delivred"],
    };

    const result = deriveStatusConfig(board);

    expect(result.todoStatuses).toEqual(["Prêt à faire", "Ready to do"]);
    expect(result.devStartStatuses).toEqual(["Dev en cours", "En attente"]);
    expect(result.inProgressStatuses).toEqual(["Dev en cours", "En attente", "À revoir", "Reviewed"]);
    expect(result.activeStatuses).toEqual(["Dev en cours", "En attente"]);
    expect(result.queueStatuses).toEqual(["À revoir", "Reviewed"]);
    expect(result.doneStatuses).toEqual(["Livré", "Delivred"]);
  });

  it("colonne active avec devStart apparaît dans devStartStatuses ET inProgressStatuses", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", devStart: true, statuses: ["Dev en cours"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStartStatuses).toContain("Dev en cours");
    expect(result.inProgressStatuses).toContain("Dev en cours");
  });

  it("retourne doneStatuses vides de legacy si legacyDoneStatuses absent", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Done", type: "done", statuses: ["Terminé"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.doneStatuses).toEqual(["Terminé"]);
  });

  it("union sans doublon pour deux colonnes devStart", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", devStart: true, statuses: ["Dev en cours", "Partagé"] },
        { name: "QA", type: "active", devStart: true, statuses: ["QA en cours", "Partagé"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStartStatuses).toEqual(["Dev en cours", "Partagé", "QA en cours"]);
    expect(result.devStartStatuses.filter((s) => s === "Partagé")).toHaveLength(1);
  });

  it("déduplique statut présent dans colonne done ET legacyDoneStatuses", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Done", type: "done", statuses: ["Livré", "Doublon"] },
      ],
      legacyDoneStatuses: ["Doublon", "Delivred"],
    };

    const result = deriveStatusConfig(board);

    expect(result.doneStatuses.filter((s) => s === "Doublon")).toHaveLength(1);
    expect(result.doneStatuses).toContain("Livré");
    expect(result.doneStatuses).toContain("Delivred");
  });

  it("colonne active+devStart avec legacyStatuses — legacy dans devStart, active et inProgress", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", devStart: true, statuses: ["Dev en cours"], legacyStatuses: ["Dev in progress"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStartStatuses).toContain("Dev en cours");
    expect(result.devStartStatuses).toContain("Dev in progress");
    expect(result.activeStatuses).toContain("Dev en cours");
    expect(result.activeStatuses).toContain("Dev in progress");
    expect(result.inProgressStatuses).toContain("Dev en cours");
    expect(result.inProgressStatuses).toContain("Dev in progress");
  });

  it("colonne sans legacyStatuses — comportement inchangé", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", devStart: true, statuses: ["Dev en cours"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStartStatuses).toEqual(["Dev en cours"]);
    expect(result.activeStatuses).toEqual(["Dev en cours"]);
  });

  it("colonne done avec legacyStatuses — legacy inclus dans doneStatuses", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Done", type: "done", statuses: ["Livré"], legacyStatuses: ["Old Done"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.doneStatuses).toContain("Livré");
    expect(result.doneStatuses).toContain("Old Done");
  });

  it("même nom dans statuses et legacyStatuses — dédupliqué dans la liste dérivée", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", statuses: ["En cours", "Partagé"], legacyStatuses: ["Partagé", "Dev in progress"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.activeStatuses.filter((s) => s === "Partagé")).toHaveLength(1);
    expect(result.activeStatuses).toContain("En cours");
    expect(result.activeStatuses).toContain("Dev in progress");
  });

  it("queueStatuses vide et inProgressStatuses = active seulement si aucune colonne queue", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", statuses: ["Dev en cours"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.queueStatuses).toEqual([]);
    expect(result.inProgressStatuses).toEqual(["Dev en cours"]);
  });
});

describe("deriveStatusConfig — groupes role-based", () => {
  it("colonnes avec role distinct → groupes devStatuses/qaStatuses/poStatuses corrects", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", devStart: true, role: "dev", statuses: ["En dev"] },
        { name: "File QA", type: "queue", role: "qa", statuses: ["En attente QA"] },
        { name: "QA", type: "active", role: "qa", statuses: ["En test"] },
        { name: "Validation PO", type: "queue", role: "po", statuses: ["À valider"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStatuses).toEqual(["En dev"]);
    expect(result.qaStatuses).toEqual(["En attente QA", "En test"]);
    expect(result.poStatuses).toEqual(["À valider"]);
  });

  it("aucune colonne avec role → trois groupes vides", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Todo", type: "todo", statuses: ["À faire"] },
        { name: "Dev", type: "active", statuses: ["En dev"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStatuses).toEqual([]);
    expect(result.qaStatuses).toEqual([]);
    expect(result.poStatuses).toEqual([]);
  });

  it("colonne type done avec role po → incluse dans poStatuses", () => {
    const board: BoardConfig = {
      columns: [
        { name: "À valider", type: "done", role: "po", statuses: ["À valider"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.poStatuses).toContain("À valider");
  });

  it("plusieurs colonnes role qa → statuts unionnés sans doublon", () => {
    const board: BoardConfig = {
      columns: [
        { name: "File QA", type: "queue", role: "qa", statuses: ["En attente QA", "Partagé"] },
        { name: "QA", type: "active", role: "qa", statuses: ["En test", "Partagé"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.qaStatuses).toContain("En attente QA");
    expect(result.qaStatuses).toContain("En test");
    expect(result.qaStatuses.filter((s) => s === "Partagé")).toHaveLength(1);
  });

  it("legacyStatuses d'une colonne avec role → inclus dans le groupe role", () => {
    const board: BoardConfig = {
      columns: [
        { name: "Dev", type: "active", role: "dev", statuses: ["En dev"], legacyStatuses: ["In Progress"] },
      ],
    };

    const result = deriveStatusConfig(board);

    expect(result.devStatuses).toContain("En dev");
    expect(result.devStatuses).toContain("In Progress");
  });
});

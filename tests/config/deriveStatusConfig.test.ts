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

import { describe, it, expect } from "vitest";
import { validateStatusConfig } from "../../src/main";

const DB_STATUSES = [
  { name: "To Do", categoryKey: "new" },
  { name: "In Progress", categoryKey: "indeterminate" },
  { name: "Done", categoryKey: "done" },
];

describe("validateStatusConfig", () => {
  it("section vide ignorée — non présente dans le résultat", () => {
    const result = validateStatusConfig(
      [{ label: "activeStatuses", statuses: [] }],
      DB_STATUSES,
    );
    expect(result.sections).toHaveLength(0);
    expect(result.missingCount).toBe(0);
  });

  it("tous les statuts trouvés — missingCount=0, tous found=true", () => {
    const result = validateStatusConfig(
      [{ label: "todoStatuses", statuses: ["To Do"] }],
      DB_STATUSES,
    );
    expect(result.missingCount).toBe(0);
    expect(result.sections[0].entries[0]).toEqual({ name: "To Do", found: true, isLegacy: false });
  });

  it("statut absent dans une section non-done — isLegacy=false, missingCount++", () => {
    const result = validateStatusConfig(
      [{ label: "todoStatuses", statuses: ["To Do", "Backlog"] }],
      DB_STATUSES,
    );
    expect(result.missingCount).toBe(1);
    const backlog = result.sections[0].entries.find((e) => e.name === "Backlog");
    expect(backlog).toEqual({ name: "Backlog", found: false, isLegacy: false });
  });

  it("statut absent dans doneStatuses — isLegacy=true, non comptabilisé dans missingCount", () => {
    const result = validateStatusConfig(
      [{ label: "doneStatuses", statuses: ["Done", "To Be Validated"] }],
      DB_STATUSES,
    );
    expect(result.missingCount).toBe(0);
    const legacy = result.sections[0].entries.find((e) => e.name === "To Be Validated");
    expect(legacy).toEqual({ name: "To Be Validated", found: false, isLegacy: true });
  });

  it("mix absent non-done + absent doneStatuses — missingCount compte seulement non-done", () => {
    const result = validateStatusConfig(
      [
        { label: "todoStatuses", statuses: ["Backlog"] },
        { label: "doneStatuses", statuses: ["Old Done"] },
      ],
      DB_STATUSES,
    );
    expect(result.missingCount).toBe(1);
  });

  it("statut legacy non-done absent de la DB — isLegacy=true, non comptabilisé dans missingCount", () => {
    const legacyNames = new Set(["Dev in progress"]);
    const result = validateStatusConfig(
      [{ label: "activeStatuses", statuses: ["Dev in progress"] }],
      DB_STATUSES,
      legacyNames,
    );
    expect(result.missingCount).toBe(0);
    const entry = result.sections[0].entries[0];
    expect(entry).toEqual({ name: "Dev in progress", found: false, isLegacy: true });
  });

  it("statut dans legacyNames ET présent en DB — found=true, isLegacy=false", () => {
    const legacyNames = new Set(["In Progress"]);
    const result = validateStatusConfig(
      [{ label: "activeStatuses", statuses: ["In Progress"] }],
      DB_STATUSES,
      legacyNames,
    );
    expect(result.missingCount).toBe(0);
    const entry = result.sections[0].entries[0];
    expect(entry).toEqual({ name: "In Progress", found: true, isLegacy: false });
  });
});

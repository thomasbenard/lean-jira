import { describe, it, expect, beforeEach } from "vitest";
import {
  workingDaysBetween,
  percentile,
  bucketize,
  removeUpperOutliers,
  statsFromDays,
  avg,
  buildDeliveredCte,
  buildExcludeIssueTypesFragment,
  SECONDS_PER_DAY,
  fetchDeliveredTransitions,
  groupByIssue,
  computeRoleDays,
  toRoleStatuses,
  type TransitionRow,
  type RoleStatuses,
} from "../../src/metrics/utils";
import type Database from "better-sqlite3";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";

describe("workingDaysBetween", () => {
  it("retourne 0 quand to === from", () => {
    expect(workingDaysBetween("2025-01-06T09:00:00Z", "2025-01-06T09:00:00Z")).toBe(0);
  });

  it("retourne 0 quand to < from", () => {
    expect(workingDaysBetween("2025-01-07T09:00:00Z", "2025-01-06T09:00:00Z")).toBe(0);
  });

  it("Lundi→Mardi = 1 jour ouvré", () => {
    expect(workingDaysBetween("2025-01-06T09:00:00Z", "2025-01-07T09:00:00Z")).toBe(1);
  });

  it("Lundi→Lundi suivant (7 cal) = 5 jours ouvrés", () => {
    expect(workingDaysBetween("2025-01-06T09:00:00Z", "2025-01-13T09:00:00Z")).toBe(5);
  });

  it("3 semaines pleines = 15 jours ouvrés", () => {
    expect(workingDaysBetween("2025-01-06T09:00:00Z", "2025-01-27T09:00:00Z")).toBe(15);
  });

  it("Vendredi→Lundi = 1 jour ouvré (skip week-end)", () => {
    expect(workingDaysBetween("2025-01-10T09:00:00Z", "2025-01-13T09:00:00Z")).toBe(1);
  });

  it("fraction de journée un lundi (09:00→15:00 = 0.25j cal)", () => {
    const result = workingDaysBetween("2025-01-06T09:00:00Z", "2025-01-06T15:00:00Z");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("fraction tombe un samedi → 0", () => {
    // Samedi 11 jan 09:00 → 15:00
    expect(workingDaysBetween("2025-01-11T09:00:00Z", "2025-01-11T15:00:00Z")).toBe(0);
  });

  it("Mercredi→Vendredi = 2 jours ouvrés (base fixture cycle-time)", () => {
    expect(workingDaysBetween("2025-01-08T09:00:00Z", "2025-01-10T09:00:00Z")).toBe(2);
  });

  it("Lundi→Vendredi même semaine = 4 jours ouvrés (base fixture lead-time)", () => {
    expect(workingDaysBetween("2025-01-06T09:00:00Z", "2025-01-10T09:00:00Z")).toBe(4);
  });
});

describe("percentile", () => {
  it("tableau vide → 0", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("élément unique → cet élément", () => {
    expect(percentile([42], 50)).toBe(42);
  });

  it("p50 sur [1..10]", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(arr, 50)).toBe(5);
  });

  it("p85 sur [1..10]", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(arr, 85)).toBe(9);
  });

  it("p95 sur [1..10]", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(arr, 95)).toBe(10);
  });

  it("p100 → dernier élément", () => {
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });

  it("p0 → premier élément (formule ceil → index 0)", () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
  });
});

describe("bucketize — méthode time (seuils par défaut)", () => {
  const TIME = { method: "time" as const };
  const e = (s: number | null) => ({ originalEstimateSeconds: s, storyPoints: null, sizeLabel: null });

  it("isBug=true → BUG quelle que soit l'estimation", () => {
    expect(bucketize(e(99999), true, TIME)).toBe("BUG");
    expect(bucketize(e(null), true, TIME)).toBe("BUG");
  });

  it("null → UNESTIMATED", () => {
    expect(bucketize(e(null), false, TIME)).toBe("UNESTIMATED");
  });

  it("0 → UNESTIMATED", () => {
    expect(bucketize(e(0), false, TIME)).toBe("UNESTIMATED");
  });

  it("negatif → UNESTIMATED", () => {
    expect(bucketize(e(-100), false, TIME)).toBe("UNESTIMATED");
  });

  it("< 0.5j → XS", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 0.4), false, TIME)).toBe("XS");
  });

  it("seuil XS/S : 0.5j exactement → S", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 0.5), false, TIME)).toBe("S");
  });

  it("< 1j → S", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 0.8), false, TIME)).toBe("S");
  });

  it("seuil S/M : 1j exactement → M", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 1), false, TIME)).toBe("M");
  });

  it("< 3j → M", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 2), false, TIME)).toBe("M");
  });

  it("seuil M/L : 3j exactement → L", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 3), false, TIME)).toBe("L");
  });

  it("< 5j → L", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 4), false, TIME)).toBe("L");
  });

  it("seuil L/XL : 5j exactement → XL", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 5), false, TIME)).toBe("XL");
  });

  it(">= 5j → XL", () => {
    expect(bucketize(e(SECONDS_PER_DAY * 10), false, TIME)).toBe("XL");
  });
});

describe("removeUpperOutliers", () => {
  it("< 4 valeurs → retour trié, excluded=0", () => {
    expect(removeUpperOutliers([1, 2, 3])).toEqual({ kept: [1, 2, 3], excluded: 0 });
  });

  it("< 4 valeurs non triées → trié en sortie", () => {
    expect(removeUpperOutliers([48.4, 8.8])).toEqual({ kept: [8.8, 48.4], excluded: 0 });
  });

  it("tableau vide → intact", () => {
    expect(removeUpperOutliers([])).toEqual({ kept: [], excluded: 0 });
  });

  it("retire valeur extrême (distribution asymétrique droite)", () => {
    const { kept, excluded } = removeUpperOutliers([1, 2, 3, 100]);
    expect(kept).toEqual([1, 2, 3]);
    expect(excluded).toBe(1);
  });

  it("distribution uniforme → rien retiré", () => {
    const { kept, excluded } = removeUpperOutliers([5, 5, 5, 5]);
    expect(excluded).toBe(0);
    expect(kept).toHaveLength(4);
  });

  it("ne retire pas les valeurs <= upper fence", () => {
    // [1,2,3,4] : q1=1, q3=4, iqr=3, upper=4+4.5=8.5 → tout conservé
    const { excluded } = removeUpperOutliers([1, 2, 3, 4]);
    expect(excluded).toBe(0);
  });
});

describe("statsFromDays", () => {
  it("tableau vide → tout à 0", () => {
    const s = statsFromDays([]);
    expect(s.count).toBe(0);
    expect(s.avgDays).toBe(0);
    expect(s.medianDays).toBe(0);
    expect(s.p85Days).toBe(0);
    expect(s.p95Days).toBe(0);
  });

  it("excludeOutliers=false → count = longueur d'entrée", () => {
    const s = statsFromDays([1, 2, 3, 4, 5], false);
    expect(s.count).toBe(5);
    expect(s.excludedOutliers).toBe(0);
  });

  it("stats correctes sur [1,2,3,4,5] sans outliers", () => {
    const s = statsFromDays([1, 2, 3, 4, 5], false);
    expect(s.avgDays).toBe(3);
    expect(s.medianDays).toBe(3);
    expect(s.p85Days).toBe(5);
    expect(s.p95Days).toBe(5);
  });

  it("excludeOutliers=true avec outlier → excludedOutliers > 0", () => {
    const s = statsFromDays([1, 2, 3, 4, 100], true);
    expect(s.excludedOutliers).toBeGreaterThan(0);
    expect(s.count).toBeLessThan(5);
  });

  it("n=2 non trié → p85 >= medianDays (régression bug XL bucket)", () => {
    // Ordre d'insertion SQL aléatoire : la plus grande valeur en premier
    const s = statsFromDays([48.4, 8.8]);
    expect(s.p85Days).toBeGreaterThanOrEqual(s.medianDays);
    expect(s.medianDays).toBeCloseTo(8.8, 5);
    expect(s.p85Days).toBeCloseTo(48.4, 5);
  });
});

describe("avg", () => {
  it("tableau vide → 0", () => {
    expect(avg([])).toBe(0);
  });

  it("élément unique → cet élément", () => {
    expect(avg([7])).toBe(7);
  });

  it("[1,2,3,4,5] → 3", () => {
    expect(avg([1, 2, 3, 4, 5])).toBe(3);
  });
});

describe("buildExcludeIssueTypesFragment", () => {
  it("liste vide → sql vide, args vides", () => {
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment([]);
    expect(excludeSql).toBe("");
    expect(excludeArgs).toEqual([]);
  });

  it("1 type, alias par défaut 'i' → AND i.issue_type NOT IN (?)", () => {
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(["Feature"]);
    expect(excludeSql).toBe("AND i.issue_type NOT IN (?)");
    expect(excludeArgs).toEqual(["Feature"]);
  });

  it("2 types → 2 placeholders", () => {
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(["Feature", "Epic"]);
    expect(excludeSql).toBe("AND i.issue_type NOT IN (?,?)");
    expect(excludeArgs).toEqual(["Feature", "Epic"]);
  });

  it("alias personnalisé → préfixe correct", () => {
    const { excludeSql } = buildExcludeIssueTypesFragment(["Epic"], "issues");
    expect(excludeSql).toBe("AND issues.issue_type NOT IN (?)");
  });

  it("alias vide → sans préfixe de table", () => {
    const { excludeSql } = buildExcludeIssueTypesFragment(["Epic"], "");
    expect(excludeSql).toBe("AND issue_type NOT IN (?)");
  });
});

describe("buildDeliveredCte", () => {
  it("1 statut → 1 placeholder dans le CTE", () => {
    const { cte, args } = buildDeliveredCte(["Done"]);
    expect((cte.match(/\?/g) ?? []).length).toBe(1);
    expect(args).toEqual(["Done"]);
  });

  it("3 statuts → 3 placeholders", () => {
    const { cte, args } = buildDeliveredCte(["Done", "Delivered", "Closed"]);
    expect((cte.match(/\?/g) ?? []).length).toBe(3);
    expect(args).toHaveLength(3);
  });

  it("args = statuts en entrée", () => {
    const statuses = ["Done", "Resolved"];
    const { args } = buildDeliveredCte(statuses);
    expect(args).toEqual(statuses);
  });

  it("CTE contient GROUP BY issue_key", () => {
    const { cte } = buildDeliveredCte(["Done"]);
    expect(cte).toContain("GROUP BY issue_key");
  });

  it("CTE contient MIN(transitioned_at)", () => {
    const { cte } = buildDeliveredCte(["Done"]);
    expect(cte).toContain("MIN(transitioned_at)");
  });
});

// ─── toRoleStatuses ──────────────────────────────────────────────────────────

describe("toRoleStatuses", () => {
  it("champs absents → tableaux vides", () => {
    const result = toRoleStatuses({ ...TEST_CONFIG });
    expect(result).toEqual({ devStatuses: [], qaStatuses: [], poStatuses: [] });
  });

  it("champs présents → propagés tels quels", () => {
    const result = toRoleStatuses({
      ...TEST_CONFIG,
      devStatuses: ["In Progress"],
      qaStatuses: ["In Review"],
      poStatuses: ["Validation"],
    });
    expect(result.devStatuses).toEqual(["In Progress"]);
    expect(result.qaStatuses).toEqual(["In Review"]);
    expect(result.poStatuses).toEqual(["Validation"]);
  });
});

// ─── groupByIssue ────────────────────────────────────────────────────────────

function makeRow(key: string, to_status: string, transitioned_at: string): TransitionRow {
  return { key, done_at: "2025-01-13T09:00:00Z", started_at: "2025-01-08T09:00:00Z", to_status, transitioned_at };
}

describe("groupByIssue", () => {
  it("tableau vide → Map vide", () => {
    const map = groupByIssue([]);
    expect(map.size).toBe(0);
  });

  it("une seule issue → Map avec une entrée", () => {
    const rows = [makeRow("PROJ-1", "In Progress", "2025-01-08T09:00:00Z")];
    const map = groupByIssue(rows);
    expect(map.size).toBe(1);
    expect(map.get("PROJ-1")).toHaveLength(1);
  });

  it("deux issues distinctes → deux entrées dans la Map", () => {
    const rows = [
      makeRow("PROJ-1", "In Progress", "2025-01-08T09:00:00Z"),
      makeRow("PROJ-2", "In Progress", "2025-01-08T09:00:00Z"),
    ];
    const map = groupByIssue(rows);
    expect(map.size).toBe(2);
  });

  it("plusieurs transitions pour une issue → toutes regroupées, ordre préservé", () => {
    const rows = [
      makeRow("PROJ-1", "In Progress", "2025-01-08T09:00:00Z"),
      makeRow("PROJ-1", "In Review",   "2025-01-10T09:00:00Z"),
    ];
    const map = groupByIssue(rows);
    const entries = map.get("PROJ-1")!;
    expect(entries).toHaveLength(2);
    expect(entries[0].to_status).toBe("In Progress");
    expect(entries[1].to_status).toBe("In Review");
  });
});

// ─── computeRoleDays ─────────────────────────────────────────────────────────

const NO_ROLES: RoleStatuses = { devStatuses: [], qaStatuses: [], poStatuses: [] };
const ROLES: RoleStatuses = {
  devStatuses: ["In Progress"],
  qaStatuses: ["In Review"],
  poStatuses: ["Validation"],
};

describe("computeRoleDays", () => {
  it("pas de statuts role → retourne {0, 0, 0}", () => {
    const rows = [makeRow("PROJ-1", "In Progress", "2025-01-08T09:00:00Z")];
    const result = computeRoleDays(rows, "2025-01-13T09:00:00Z", NO_ROLES);
    expect(result).toEqual({ devDays: 0, qaDays: 0, poDays: 0 });
  });

  it("statut dev → accumule devDays, autres à 0", () => {
    // In Progress lun 06 → Done lun 13 = 5j ouvrés
    const rows = [makeRow("PROJ-1", "In Progress", "2025-01-06T09:00:00Z")];
    const result = computeRoleDays(rows, "2025-01-13T09:00:00Z", ROLES);
    expect(result.devDays).toBeCloseTo(5, 5);
    expect(result.qaDays).toBe(0);
    expect(result.poDays).toBe(0);
  });

  it("statut qa → accumule qaDays", () => {
    // In Review ven 10 → Done lun 13 = 1j
    const rows = [makeRow("PROJ-1", "In Review", "2025-01-10T09:00:00Z")];
    const result = computeRoleDays(rows, "2025-01-13T09:00:00Z", ROLES);
    expect(result.qaDays).toBeCloseTo(1, 5);
    expect(result.devDays).toBe(0);
  });

  it("statut po → accumule poDays", () => {
    const rows = [makeRow("PROJ-1", "Validation", "2025-01-10T09:00:00Z")];
    const result = computeRoleDays(rows, "2025-01-13T09:00:00Z", ROLES);
    expect(result.poDays).toBeCloseTo(1, 5);
    expect(result.devDays).toBe(0);
  });

  it("statut hors rôles → ignoré, ne contribue à aucun groupe", () => {
    // "To Do" n'est dans aucun rôle
    const rows = [makeRow("PROJ-1", "To Do", "2025-01-06T09:00:00Z")];
    const result = computeRoleDays(rows, "2025-01-13T09:00:00Z", ROLES);
    expect(result).toEqual({ devDays: 0, qaDays: 0, poDays: 0 });
  });

  it("multi-passes dans un rôle (rework) → durées cumulées", () => {
    // In Progress lun 06 → In Review mer 08 (2j dev)
    // In Review mer 08 → In Progress ven 10 (2j qa)
    // In Progress ven 10 → Done lun 13 (1j dev)
    // Total : devDays = 3, qaDays = 2
    const rows = [
      makeRow("PROJ-1", "In Progress", "2025-01-06T09:00:00Z"),
      makeRow("PROJ-1", "In Review",   "2025-01-08T09:00:00Z"),
      makeRow("PROJ-1", "In Progress", "2025-01-10T09:00:00Z"),
    ];
    const result = computeRoleDays(rows, "2025-01-13T09:00:00Z", ROLES);
    expect(result.devDays).toBeCloseTo(3, 5);
    expect(result.qaDays).toBeCloseTo(2, 5);
    expect(result.poDays).toBe(0);
  });

  it("transition avec end <= start → ignorée (pas de jours négatifs)", () => {
    // In Progress et In Review ont le même timestamp → In Progress contribue 0j
    // In Review jan 08 (mer) → done jan 09 (jeu) = 1j qa
    const rows = [
      makeRow("PROJ-1", "In Progress", "2025-01-08T09:00:00Z"),
      makeRow("PROJ-1", "In Review",   "2025-01-08T09:00:00Z"), // même horodatage
    ];
    const result = computeRoleDays(rows, "2025-01-09T09:00:00Z", ROLES);
    expect(result.devDays).toBe(0);
    expect(result.qaDays).toBeCloseTo(1, 5);
  });
});

// ─── fetchDeliveredTransitions ───────────────────────────────────────────────

describe("fetchDeliveredTransitions", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
    resetSeq();
  });

  it("DB vide → retourne []", () => {
    const rows = fetchDeliveredTransitions(db, TEST_CONFIG);
    expect(rows).toHaveLength(0);
  });

  it("issue avec todo + devStart + done → incluse dans la population", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const rows = fetchDeliveredTransitions(db, TEST_CONFIG);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.key === "PROJ-1")).toBe(true);
  });

  it("issue sans transition devStart → exclue", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",  at: "2025-01-06T09:00:00Z" },
      { to: "Done",   at: "2025-01-13T09:00:00Z" },
    ]);
    const rows = fetchDeliveredTransitions(db, TEST_CONFIG);
    expect(rows).toHaveLength(0);
  });

  it("issue sans transition todo → exclue", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const rows = fetchDeliveredTransitions(db, TEST_CONFIG);
    expect(rows).toHaveLength(0);
  });

  it("cutoffDate après done_at → population vide → retourne []", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const cfg = { ...TEST_CONFIG, cutoffDate: "2026-01-01" };
    const rows = fetchDeliveredTransitions(db, cfg);
    expect(rows).toHaveLength(0);
  });

  it("transitions retournées ordonnées par key ASC, transitioned_at ASC", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" },
    ]);
    const rows = fetchDeliveredTransitions(db, TEST_CONFIG);
    const keys = rows.map((r) => r.key);
    expect(keys[0]).toBe("PROJ-1");
    const proj2Rows = rows.filter((r) => r.key === "PROJ-2");
    for (let i = 1; i < proj2Rows.length; i++) {
      expect(proj2Rows[i].transitioned_at >= proj2Rows[i - 1].transitioned_at).toBe(true);
    }
  });

  it("transitions hors fenêtre [started_at, done_at] exclues", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-01T09:00:00Z" }, // avant devStart → pas dans fenêtre
      { to: "In Progress", at: "2025-01-08T09:00:00Z" }, // started_at
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-13T09:00:00Z" }, // done_at
    ]);
    const rows = fetchDeliveredTransitions(db, TEST_CONFIG);
    // "To Do" est avant started_at → exclu
    expect(rows.every((r) => r.to_status !== "To Do")).toBe(true);
  });
});

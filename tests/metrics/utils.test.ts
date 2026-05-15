import { describe, it, expect } from "vitest";
import {
  workingDaysBetween,
  percentile,
  bucketize,
  removeUpperOutliers,
  statsFromDays,
  avg,
  SECONDS_PER_DAY,
  toRoleStatuses,
} from "../../src/metrics/utils";
import { TEST_CONFIG } from "../helpers/seeders";

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


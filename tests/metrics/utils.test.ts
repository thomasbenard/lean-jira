import { describe, it, expect } from "vitest";
import {
  workingDaysBetween,
  percentile,
  bucketize,
  removeUpperOutliers,
  statsFromDays,
  avg,
  buildDeliveredCte,
  SECONDS_PER_DAY,
} from "../../src/metrics/utils";

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

describe("bucketize", () => {
  it("isBug=true → BUG quelle que soit l'estimation", () => {
    expect(bucketize(99999, true)).toBe("BUG");
    expect(bucketize(null, true)).toBe("BUG");
  });

  it("null → UNESTIMATED", () => {
    expect(bucketize(null)).toBe("UNESTIMATED");
  });

  it("0 → UNESTIMATED", () => {
    expect(bucketize(0)).toBe("UNESTIMATED");
  });

  it("negatif → UNESTIMATED", () => {
    expect(bucketize(-100)).toBe("UNESTIMATED");
  });

  it("< 0.5j → XS", () => {
    expect(bucketize(SECONDS_PER_DAY * 0.4)).toBe("XS");
  });

  it("seuil XS/S : 0.5j exactement → S", () => {
    expect(bucketize(SECONDS_PER_DAY * 0.5)).toBe("S");
  });

  it("< 1j → S", () => {
    expect(bucketize(SECONDS_PER_DAY * 0.8)).toBe("S");
  });

  it("seuil S/M : 1j exactement → M", () => {
    expect(bucketize(SECONDS_PER_DAY * 1)).toBe("M");
  });

  it("< 3j → M", () => {
    expect(bucketize(SECONDS_PER_DAY * 2)).toBe("M");
  });

  it("seuil M/L : 3j exactement → L", () => {
    expect(bucketize(SECONDS_PER_DAY * 3)).toBe("L");
  });

  it("< 5j → L", () => {
    expect(bucketize(SECONDS_PER_DAY * 4)).toBe("L");
  });

  it("seuil L/XL : 5j exactement → XL", () => {
    expect(bucketize(SECONDS_PER_DAY * 5)).toBe("XL");
  });

  it(">= 5j → XL", () => {
    expect(bucketize(SECONDS_PER_DAY * 10)).toBe("XL");
  });
});

describe("removeUpperOutliers", () => {
  it("< 4 valeurs → retour intact, excluded=0", () => {
    expect(removeUpperOutliers([1, 2, 3])).toEqual({ kept: [1, 2, 3], excluded: 0 });
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

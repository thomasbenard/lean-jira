import { describe, it, expect } from "vitest";
import { computeMovingAvg } from "../../src/report/generate";

describe("computeMovingAvg", () => {
  it("série vide retourne tableau vide", () => {
    expect(computeMovingAvg([])).toEqual([]);
  });

  it("n < window : tous les points retournent null", () => {
    expect(computeMovingAvg([1, 2, 3])).toEqual([null, null, null]);
  });

  it("n = window : premiers (window-1) null, dernier = moyenne", () => {
    expect(computeMovingAvg([1, 2, 3, 4])).toEqual([null, null, null, 2.5]);
  });

  it("n > window : moyenne glissante correcte sur chaque position", () => {
    expect(computeMovingAvg([1, 2, 3, 4, 5])).toEqual([null, null, null, 2.5, 3.5]);
  });

  it("série constante : tendance = valeur constante (pente zéro)", () => {
    expect(computeMovingAvg([10, 10, 10, 10, 10])).toEqual([null, null, null, 10, 10]);
  });

  it("arrondi à 2 décimales", () => {
    const result = computeMovingAvg([1, 1, 1, 1, 2]);
    expect(result[4]).toBe(1.25);
  });

  it("valeurs zéro incluses dans la fenêtre sans filtrage", () => {
    const result = computeMovingAvg([0, 0, 0, 4]);
    expect(result[3]).toBe(1);
  });

  it("window personnalisée de 2", () => {
    expect(computeMovingAvg([1, 3, 5, 7], 2)).toEqual([null, 2, 4, 6]);
  });
});

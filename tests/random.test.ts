import { describe, it, expect } from "vitest";
import { initRandom, random } from "../src/random";

describe("random", () => {
  it("seed identique produit la même suite", () => {
    initRandom("2026-01-15");
    const seq1 = Array.from({ length: 10 }, () => random());
    initRandom("2026-01-15");
    const seq2 = Array.from({ length: 10 }, () => random());
    expect(seq1).toEqual(seq2);
  });

  it("seeds différents produisent des suites différentes", () => {
    initRandom("2026-01-15");
    const seq1 = Array.from({ length: 5 }, () => random());
    initRandom("2026-01-16");
    const seq2 = Array.from({ length: 5 }, () => random());
    expect(seq1).not.toEqual(seq2);
  });

  it("sans seed, délègue à Math.random (valeurs entre 0 et 1)", () => {
    initRandom(undefined);
    const val = random();
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });
});

import { describe, it, expect } from "vitest";
import { evalLowerBetter, evalHigherBetter } from "../../src/report/generate";

describe("evalLowerBetter", () => {
  const t = { warn: 5, crit: 10 };

  it("retourne vert si valeur dans la zone saine", () => {
    expect(evalLowerBetter(3, t)).toBe("green");
  });

  it("retourne orange si valeur en zone orange", () => {
    expect(evalLowerBetter(7, t)).toBe("orange");
  });

  it("retourne rouge si valeur en zone rouge", () => {
    expect(evalLowerBetter(12, t)).toBe("red");
  });

  it("retourne vert si valeur exactement au seuil warn (inclusif)", () => {
    expect(evalLowerBetter(5, t)).toBe("green");
  });

  it("retourne none si seuil absent", () => {
    expect(evalLowerBetter(12, undefined)).toBe("none");
  });

  it("retourne none si valeur null même si seuil présent", () => {
    expect(evalLowerBetter(null, t)).toBe("none");
  });
});

describe("evalHigherBetter", () => {
  const t = { warn: 3, crit: 1 };

  it("retourne vert si throughput élevé", () => {
    expect(evalHigherBetter(5, t)).toBe("green");
  });

  it("retourne orange si throughput faible", () => {
    expect(evalHigherBetter(2, t)).toBe("orange");
  });

  it("retourne rouge si throughput nul", () => {
    expect(evalHigherBetter(0, t)).toBe("red");
  });

  it("retourne vert si valeur exactement au seuil warn (inclusif)", () => {
    expect(evalHigherBetter(3, t)).toBe("green");
  });

  it("retourne orange si valeur exactement au seuil crit (inclusif)", () => {
    expect(evalHigherBetter(1, t)).toBe("orange");
  });

  it("retourne none si valeur null même si seuil présent", () => {
    expect(evalHigherBetter(null, t)).toBe("none");
  });

  it("retourne none si seuil absent", () => {
    expect(evalHigherBetter(5, undefined)).toBe("none");
  });
});

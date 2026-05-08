import { describe, it, expect, beforeEach } from "vitest";
import { initClock, now } from "../src/clock";

describe("clock", () => {
  beforeEach(() => { initClock(undefined); });

  it("retourne une date proche de maintenant par défaut", () => {
    const before = Date.now();
    const result = now().getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("retourne la date figée quand initClock est appelé avec une ISO string", () => {
    initClock("2026-01-15");
    const t1 = now().toISOString();
    const t2 = now().toISOString();
    expect(t1).toBe(t2);
    expect(t1.startsWith("2026-01-15")).toBe(true);
  });

  it("restitue le comportement réel après reset", () => {
    initClock("2026-01-15");
    initClock(undefined);
    const before = Date.now();
    const result = now().getTime();
    expect(result).toBeGreaterThanOrEqual(before);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("i18n — initLocale + t()", () => {
  // Réinitialise le module entre chaque test pour éviter pollution d'état global
  beforeEach(async () => {
    vi.resetModules();
  });

  it("retourne anglais par défaut sans initLocale", async () => {
    const { t } = await import("../../src/i18n/index");
    expect(t("sync.start", { projectKey: "FOO" })).toBe("Syncing project FOO...");
  });

  it("retourne anglais après initLocale('en')", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("en");
    expect(t("sync.done", { count: 42 })).toBe("Sync complete. 42 issues stored.");
  });

  it("retourne français après initLocale('fr')", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("fr");
    expect(t("sync.start", { projectKey: "KECK" })).toBe("Sync projet KECK...");
  });

  it("interpole plusieurs variables", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("en");
    expect(t("sync.statusesFetched", { count: 10, doneCount: 3 })).toBe(
      "  10 statuses fetched (3 in 'done' category)",
    );
  });

  it("laisse {{key}} intact si variable manquante", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("en");
    const result = t("sync.start");
    expect(result).toBe("Syncing project {{projectKey}}...");
  });

  it("bascule sur 'en' et avertit si locale inconnue", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("de");
    expect(t("listMetrics.header")).toBe("Available metrics:");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"de"'));
    warnSpy.mockRestore();
  });

  it("snapshots.done interpole count", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("en");
    expect(t("snapshots.done", { count: 7 })).toBe("Snapshots computed: 7 weekly dates.");
  });

  it("snapshots.done en français", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("fr");
    expect(t("snapshots.done", { count: 7 })).toContain("7");
  });

  it("autoconfig.wip.stripped interpole count et names", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("en");
    expect(t("autoconfig.wip.stripped", { count: 2, names: "A, B" })).toBe(
      "  ⚠ 2 config status(es) classified 'done' by Jira → excluded from WIP/flow: A, B",
    );
  });

  it("validateConfig.errors en français", async () => {
    const { t, initLocale } = await import("../../src/i18n/index");
    initLocale("fr");
    expect(t("validateConfig.errors", { count: 3 })).toContain("3");
  });

  it("toutes les clés LocaleShape existent dans en et fr", async () => {
    const { en } = await import("../../src/i18n/en");
    const { fr } = await import("../../src/i18n/fr");
    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    expect(frKeys).toEqual(enKeys);
  });
});

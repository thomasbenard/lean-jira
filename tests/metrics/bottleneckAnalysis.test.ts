import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeIssue, seedIssueWithTransitions, TEST_CONFIG, resetSeq } from "../helpers/seeders";
import {
  bottleneckAnalysisMetric,
  rankNormalize,
  computeDominantSignal,
} from "../../src/metrics/bottleneckAnalysis";
import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  resetSeq();
});

const ROLE_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  devStatuses: ["In Progress"],
  qaStatuses: ["In Review"],
  poStatuses: ["Validation PO"],
};

describe("rankNormalize", () => {
  it("assigne rang 0 au minimum, 0.5 au médian, 1 au maximum", () => {
    // [3.2, 1.1, 5.8] → idx0=médian(0.5), idx1=min(0), idx2=max(1)
    const result = rankNormalize([3.2, 1.1, 5.8]);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(1);
  });

  it("retourne [0, 0, 0] quand toutes valeurs égales", () => {
    expect(rankNormalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("retourne [0] pour un seul élément", () => {
    expect(rankNormalize([5])).toEqual([0]);
  });
});

describe("computeDominantSignal", () => {
  it("retourne stage_time quand il domine clairement (écart ≥ 0.1)", () => {
    const signal = computeDominantSignal({ stageTime: 0.8, netFlow: 0.3, rework: 0.2, ftr: 0.1 });
    expect(signal).toBe("stage_time");
  });

  it("retourne combined quand deux signaux quasi-égaux (écart < 0.1)", () => {
    // 0.7 - 0.65 = 0.05 < 0.1 → combined
    const signal = computeDominantSignal({ stageTime: 0.7, netFlow: 0.65, rework: 0.2, ftr: 0.1 });
    expect(signal).toBe("combined");
  });

  it("priorité accumulation > stage_time en cas d'égalité exacte (règle TOC)", () => {
    const signal = computeDominantSignal({ stageTime: 0.9, netFlow: 0.9, rework: 0.4, ftr: 0.2 });
    expect(signal).toBe("accumulation");
  });
});

describe("bottleneckAnalysisMetric.compute", () => {
  it("retourne count 0, primaryBottleneck null, scores 0 si aucune issue livrée", () => {
    const result = bottleneckAnalysisMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(0);
    expect(result.primaryBottleneck).toBeNull();
    expect(result.recommendation).toBe("");
    expect(result.byRole.dev.score).toBe(0);
    expect(result.byRole.qa.score).toBe(0);
    expect(result.byRole.po.score).toBe(0);
  });

  it("log un warning et retourne primaryBottleneck null si aucun rôle configuré", () => {
    const noRoles: MetricConfig = { ...TEST_CONFIG, devStatuses: [], qaStatuses: [], poStatuses: [] };
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = bottleneckAnalysisMetric.compute(db, noRoles);
    expect(result.primaryBottleneck).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bottleneck-analysis"));
    warnSpy.mockRestore();
  });

  it("retourne un résultat structuré valide avec issues livrées", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-13T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, ROLE_CONFIG);
    expect(result.count).toBe(2);
    expect(result.primaryBottleneck).not.toBeNull();
    expect(result.recommendation).not.toBe("");
    for (const role of ["dev", "qa", "po"] as const) {
      expect(result.byRole[role].score).toBeGreaterThanOrEqual(0);
      expect(result.byRole[role].score).toBeLessThanOrEqual(1);
      expect(result.byRole[role].rank).toBeGreaterThanOrEqual(1);
      expect(result.byRole[role].rank).toBeLessThanOrEqual(3);
    }
  });

  it("le primaryBottleneck est le rôle avec rank=1 et le score le plus élevé", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, ROLE_CONFIG);
    const roles = ["dev", "qa", "po"] as const;
    if (result.primaryBottleneck) {
      expect(result.byRole[result.primaryBottleneck].rank).toBe(1);
      const maxScore = Math.max(...roles.map((r) => result.byRole[r].score));
      expect(result.byRole[result.primaryBottleneck].score).toBe(maxScore);
    }
  });

  it("rôle po non configuré a score=0 et rank=3", () => {
    const noPo: MetricConfig = { ...ROLE_CONFIG, poStatuses: [] };
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, noPo);
    expect(result.byRole.po.score).toBe(0);
    expect(result.byRole.po.rank).toBe(3);
  });
});

const TWO_DEV_COL_CONFIG: MetricConfig = {
  ...TEST_CONFIG,
  devStatuses: ["In Progress", "Code Review"],
  qaStatuses: ["In Review"],
  poStatuses: ["Validation PO"],
};

describe("bottleneckAnalysisMetric.compute — dominantColumn / primaryColumn", () => {
  it("dominantColumn identifie la colonne la plus lente dans dev (fallback = statut brut sans mapping)", () => {
    // In Progress : Jan 8→Jan 15 ≈ 5j ouvrés ; Code Review : Jan 15→Jan 16 ≈ 1j
    // Sans statusToColumnName → fallback sur nom du statut
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-15T09:00:00Z" },
      { to: "Done",        at: "2025-01-16T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    expect(result.byRole.dev.dominantColumn).toBe("In Progress");
  });

  it("dominantColumn null si aucune transition livrée ne passe par le rôle po", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, ROLE_CONFIG);
    expect(result.byRole.po.dominantColumn).toBeNull();
  });

  it("primaryColumn = dominantColumn du rôle primaryBottleneck", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-15T09:00:00Z" },
      { to: "Done",        at: "2025-01-16T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    expect(result.primaryBottleneck).not.toBeNull();
    expect(result.primaryColumn).toBe(result.byRole[result.primaryBottleneck!].dominantColumn);
  });

  it("tiebreak alphabétique si deux colonnes ont la même médiane", () => {
    // In Progress : Jan 8→Jan 10 = 2j ouvrés ; Code Review : Jan 10→Jan 14 = 2j ouvrés
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    // "Code Review" < "In Progress" alphabétiquement → gagne le tiebreak
    expect(result.byRole.dev.dominantColumn).toBe("Code Review");
  });
});

describe("bottleneckAnalysisMetric.compute — byColumn", () => {
  it("byColumn contient colonnes triées par médiane décroissante au sein du rôle dev", () => {
    // In Progress : Jan 8→Jan 15 = 5j ouvrés ; Code Review : Jan 15→Jan 16 = 1j ouvré
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-15T09:00:00Z" },
      { to: "Done",        at: "2025-01-16T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    const devCols = result.byColumn.filter((c) => c.role === "dev");
    expect(devCols.length).toBe(2);
    expect(devCols[0].column).toBe("In Progress");
    expect(devCols[1].column).toBe("Code Review");
    expect(devCols[0].medianDays).toBeGreaterThan(devCols[1].medianDays);
  });

  it("byColumn.count = nombre d'issues ayant traversé la colonne", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    const inProgress = result.byColumn.find((c) => c.column === "In Progress");
    expect(inProgress?.count).toBe(2);
  });

  it("colonne jamais traversée absente de byColumn", () => {
    // Aucune issue ne passe par "Code Review"
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    const codeReview = result.byColumn.find((c) => c.column === "Code Review");
    expect(codeReview).toBeUndefined();
  });

  it("byColumn vide si aucune issue livrée", () => {
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    expect(result.byColumn).toEqual([]);
  });

  it("tiebreak alphabétique quand deux colonnes ont la même médiane", () => {
    // In Progress : Jan 8→Jan 10 = 2j ouvrés ; Code Review : Jan 10→Jan 14 = 2j ouvrés
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-14T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    const devCols = result.byColumn.filter((c) => c.role === "dev");
    // "Code Review" < "In Progress" alphabétiquement → premier en cas d'égalité
    expect(devCols[0].column).toBe("Code Review");
  });

  it("colonne avec transition instantanée absente de byColumn", () => {
    // Code Review entré et quitté au même instant → 0j → absent de byColumn
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-15T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" }, // même instant que Code Review → 0j
    ]);
    const result = bottleneckAnalysisMetric.compute(db, TWO_DEV_COL_CONFIG);
    const codeReview = result.byColumn.find((c) => c.column === "Code Review");
    expect(codeReview).toBeUndefined();
  });

  it("colonnes groupées dev en premier, puis qa", () => {
    const config: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["In Progress"],
      qaStatuses: ["In Review"],
      poStatuses: [],
    };
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "In Review",   at: "2025-01-15T09:00:00Z" },
      { to: "Done",        at: "2025-01-16T09:00:00Z" },
    ]);
    const result = bottleneckAnalysisMetric.compute(db, config);
    expect(result.byColumn.length).toBe(2);
    expect(result.byColumn[0].role).toBe("dev");
    expect(result.byColumn[1].role).toBe("qa");
  });
});

describe("bottleneckAnalysisMetric.compute — groupement par colonne board (statusToColumnName)", () => {
  it("deux statuts dans la même colonne board sont poolés en une seule entrée byColumn", () => {
    // Ticket 1 : 2j "In Progress" + 3j "Code Review" → tous deux dans colonne "Dev"
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    // Ticket 2 : 1j "In Progress" + 4j "Code Review" → même colonne "Dev"
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-2" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-09T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const config: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["In Progress", "Code Review"],
      qaStatuses: [],
      poStatuses: [],
      statusToColumnName: { "In Progress": "Dev", "Code Review": "Dev" },
    };
    const result = bottleneckAnalysisMetric.compute(db, config);
    const devCols = result.byColumn.filter((c) => c.role === "dev");
    expect(devCols.length).toBe(1);
    expect(devCols[0].column).toBe("Dev");
    expect(devCols[0].count).toBeGreaterThanOrEqual(2);
  });

  it("deux statuts dans colonnes distinctes du même rôle créent deux entrées byColumn", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-10T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const config: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["In Progress", "Code Review"],
      qaStatuses: [],
      poStatuses: [],
      statusToColumnName: { "In Progress": "Développement", "Code Review": "Revue" },
    };
    const result = bottleneckAnalysisMetric.compute(db, config);
    const devCols = result.byColumn.filter((c) => c.role === "dev");
    expect(devCols.length).toBe(2);
    expect(devCols.map((c) => c.column)).toContain("Développement");
    expect(devCols.map((c) => c.column)).toContain("Revue");
  });

  it("statut sans entrée dans statusToColumnName utilise son propre nom (fallback)", () => {
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Done",        at: "2025-01-15T09:00:00Z" },
    ]);
    const config: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["In Progress"],
      qaStatuses: [],
      poStatuses: [],
      statusToColumnName: {}, // mapping vide → fallback sur statut brut
    };
    const result = bottleneckAnalysisMetric.compute(db, config);
    const devCols = result.byColumn.filter((c) => c.role === "dev");
    expect(devCols.length).toBe(1);
    expect(devCols[0].column).toBe("In Progress");
  });

  it("dominantColumn reflète le nom de colonne board (pas le statut Jira)", () => {
    // "In Progress" domine largement → dominantColumn = "Dev" (le nom de la colonne board)
    seedIssueWithTransitions(db, makeIssue({ key: "PROJ-1" }), [
      { to: "To Do",       at: "2025-01-06T09:00:00Z" },
      { to: "In Progress", at: "2025-01-08T09:00:00Z" },
      { to: "Code Review", at: "2025-01-15T09:00:00Z" },
      { to: "Done",        at: "2025-01-16T09:00:00Z" },
    ]);
    const config: MetricConfig = {
      ...TEST_CONFIG,
      devStatuses: ["In Progress", "Code Review"],
      qaStatuses: [],
      poStatuses: [],
      statusToColumnName: { "In Progress": "Dev", "Code Review": "Dev" },
    };
    const result = bottleneckAnalysisMetric.compute(db, config);
    // Les deux statuts sont dans "Dev" → une seule colonne → dominantColumn = "Dev"
    expect(result.byRole.dev.dominantColumn).toBe("Dev");
  });
});

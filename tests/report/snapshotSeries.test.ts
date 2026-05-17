import { describe, it, expect } from "vitest";
import { buildAllChartData, buildBucketSeries, buildRoleSeries } from "../../src/report/generate";
import { latestRowsOfMetric } from "../../src/report/snapshotSeries";
import { CHART_DEFS } from "../../src/report/chartDefs";
import type { SnapshotRow } from "../../src/snapshots/compute";

describe("buildBucketSeries", () => {
  const rows: SnapshotRow[] = [
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "median", value: 3 },
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "p85", value: 5 },
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "p95", value: 7 },
    { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "XS", stat: "median", value: 1 },
    { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "median", value: 4 },
    { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "p85", value: 6 },
    { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "p95", value: 8 },
  ];

  it("filtre par bucket et retourne les dates triées", () => {
    const result = buildBucketSeries(rows, "M", ["median", "p85", "p95"]);
    expect(result.dates).toEqual(["2025-01-05", "2025-01-12"]);
  });

  it("exclut les données d'autres buckets", () => {
    const result = buildBucketSeries(rows, "M", ["median"]);
    expect(result.dates).toHaveLength(2);
    const xsResult = buildBucketSeries(rows, "XS", ["median"]);
    expect(xsResult.dates).toHaveLength(1);
    expect(xsResult.series.median).toEqual([1]);
  });

  it("retourne les séries correctes pour chaque stat", () => {
    const result = buildBucketSeries(rows, "M", ["median", "p85", "p95"]);
    expect(result.series.median).toEqual([3, 4]);
    expect(result.series.p85).toEqual([5, 6]);
    expect(result.series.p95).toEqual([7, 8]);
  });

  it("bucket sans données → dates vide", () => {
    const result = buildBucketSeries(rows, "XL", ["median", "p85", "p95"]);
    expect(result.dates).toHaveLength(0);
  });

  it("inclut la stat count quand demandée (pour sélection bucket par défaut)", () => {
    const withCount: SnapshotRow[] = [
      ...rows,
      { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "count", value: 10 },
      { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "count", value: 15 },
    ];
    const result = buildBucketSeries(withCount, "M", ["median", "p85", "p95", "count"]);
    expect(result.series.count).toEqual([10, 15]);
  });
});

describe("buildRoleSeries", () => {
  const rows: SnapshotRow[] = [
    { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "dev", stat: "median", value: 2 },
    { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "qa",  stat: "median", value: 1 },
    { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "po",  stat: "median", value: 0.5 },
    { snapshot_date: "2025-01-12", metric_name: "stage-time-breakdown", bucket: "dev", stat: "median", value: 3 },
    { snapshot_date: "2025-01-12", metric_name: "stage-time-breakdown", bucket: "qa",  stat: "median", value: 1.5 },
    // po absent à 2025-01-12
  ];

  it("dates triées, series pour chaque bucket", () => {
    const result = buildRoleSeries(rows, ["dev", "qa", "po"], "median");
    expect(result.dates).toEqual(["2025-01-05", "2025-01-12"]);
    expect(result.series["dev"]).toEqual([2, 3]);
    expect(result.series["qa"]).toEqual([1, 1.5]);
  });

  it("rôle absent pour une date → 0 (pas d'erreur)", () => {
    const result = buildRoleSeries(rows, ["dev", "qa", "po"], "median");
    const poIdx = result.dates.indexOf("2025-01-12");
    expect(result.series["po"][poIdx]).toBe(0);
  });

  it("aucune donnée → dates et séries vides", () => {
    const result = buildRoleSeries([], ["dev", "qa", "po"], "median");
    expect(result.dates).toHaveLength(0);
  });

  it("filtre par stat uniquement", () => {
    const rowsWithP85: SnapshotRow[] = [
      ...rows,
      { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "dev", stat: "p85", value: 5 },
    ];
    const result = buildRoleSeries(rowsWithP85, ["dev"], "median");
    expect(result.series["dev"]).toEqual([2, 3]);
  });
});

describe("buildAllChartData", () => {
  // pourquoi : régression — `report.hbs` lit `CHARTS.<def.key>` (e.g. `CHARTS.leadTime`)
  // pas `CHARTS.<def.id>` (id = ID du canvas DOM, e.g. `leadTimeChart`).
  // Keyer par `def.id` rendait tous les charts vides.
  it("résultat keyé par def.key (pas def.id)", () => {
    const result = buildAllChartData(() => [], CHART_DEFS);
    const leadTimeDef = CHART_DEFS.find((d) => d.key === "leadTime");
    expect(leadTimeDef).toBeDefined();
    expect(leadTimeDef!.id).toBe("leadTimeChart");
    expect(result).toHaveProperty("leadTime");
    expect(result).not.toHaveProperty("leadTimeChart");
  });

  it("def avec data: null ignoré", () => {
    const customDefs: typeof CHART_DEFS = [
      { id: "foo", key: "foo", tab: "delivery", titleKey: "t", data: null, chart: { type: "line" } },
    ];
    const result = buildAllChartData(() => [], customDefs);
    expect(result).not.toHaveProperty("foo");
  });

  it("data.mode=stats appelle buildSeries via def.key", () => {
    const rows: SnapshotRow[] = [
      { snapshot_date: "2025-01-05", metric_name: "lead-time", bucket: "", stat: "median", value: 4 },
      { snapshot_date: "2025-01-05", metric_name: "lead-time", bucket: "", stat: "p85",    value: 10 },
    ];
    const result = buildAllChartData((name) => name === "lead-time" ? rows : [], CHART_DEFS);
    expect(result["leadTime"].dates).toEqual(["2025-01-05"]);
    expect(result["leadTime"].series["median"]).toEqual([4]);
    expect(result["leadTime"].series["p85"]).toEqual([10]);
  });

  it("latestRowsOfMetric : retourne uniquement les lignes à la date max", () => {
    // pourquoi : régression — `lastDate` global (max toutes métriques) sélectionnait
    // la date du snapshot WIP quotidien, écartant les by-size hebdomadaires.
    // Le sélecteur doit calculer le max par sous-ensemble fourni.
    const rows: SnapshotRow[] = [
      { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "median", value: 3 },
      { snapshot_date: "2025-01-05", metric_name: "lead-time-by-size", bucket: "M", stat: "p85",    value: 5 },
      { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "median", value: 4 },
      { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "p85",    value: 6 },
      { snapshot_date: "2025-01-12", metric_name: "lead-time-by-size", bucket: "M", stat: "count",  value: 8 },
    ];
    const latest = latestRowsOfMetric(rows);
    expect(latest).toHaveLength(3);
    expect(latest.every((r) => r.snapshot_date === "2025-01-12")).toBe(true);
  });

  it("latestRowsOfMetric : rows vides → tableau vide (pas d'erreur)", () => {
    expect(latestRowsOfMetric([])).toEqual([]);
  });

  it("latestRowsOfMetric : dates non triées → max correct", () => {
    const rows: SnapshotRow[] = [
      { snapshot_date: "2025-01-12", metric_name: "x", bucket: "", stat: "v", value: 1 },
      { snapshot_date: "2025-01-26", metric_name: "x", bucket: "", stat: "v", value: 3 },
      { snapshot_date: "2025-01-19", metric_name: "x", bucket: "", stat: "v", value: 2 },
    ];
    const latest = latestRowsOfMetric(rows);
    expect(latest).toHaveLength(1);
    expect(latest[0].snapshot_date).toBe("2025-01-26");
  });

  it("data.mode=roleSeries appelle buildRoleSeries via def.key", () => {
    const stageDef = CHART_DEFS.find((d) => d.key === "stageTimeByRole");
    expect(stageDef).toBeDefined();
    const rows: SnapshotRow[] = [
      { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "dev", stat: "median", value: 2 },
      { snapshot_date: "2025-01-05", metric_name: "stage-time-breakdown", bucket: "qa",  stat: "median", value: 1 },
    ];
    const result = buildAllChartData((name) => name === "stage-time-breakdown" ? rows : [], [stageDef!]);
    expect(result["stageTimeByRole"].dates).toEqual(["2025-01-05"]);
    expect(result["stageTimeByRole"].series["dev"]).toEqual([2]);
  });
});

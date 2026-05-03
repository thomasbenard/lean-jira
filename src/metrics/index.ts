import type Database from "better-sqlite3";
import { type MetricConfig } from "./types";
import { leadTimeMetric } from "./leadTime";
import { leadTimeBySizeMetric } from "./leadTimeBySize";
import { leadTimeNormalizedMetric } from "./leadTimeNormalized";
import { cycleTimeMetric } from "./cycleTime";
import { cycleTimeBySizeMetric } from "./cycleTimeBySize";
import { cycleTimeNormalizedMetric } from "./cycleTimeNormalized";
import { throughputMetric } from "./throughput";
import { throughputWeightedMetric } from "./throughputWeighted";
import { bugCycleTimeMetric } from "./bugCycleTime";
import { bugThroughputMetric } from "./bugThroughput";
import { wipMetric } from "./wip";
import { flowEfficiencyMetric } from "./flowEfficiency";
import { agingWipMetric } from "./agingWip";
import { forecastMetric } from "./forecast";
import { devTimeAllocationMetric } from "./devTimeAllocation";

// Registre central. Ajouter une métrique = importer + pousser ici.
const ALL_METRICS = [
  leadTimeMetric,
  leadTimeBySizeMetric,
  leadTimeNormalizedMetric,
  cycleTimeMetric,
  cycleTimeBySizeMetric,
  cycleTimeNormalizedMetric,
  throughputMetric,
  throughputWeightedMetric,
  bugCycleTimeMetric,
  bugThroughputMetric,
  wipMetric,
  flowEfficiencyMetric,
  agingWipMetric,
  forecastMetric,
  devTimeAllocationMetric,
];

export function runAllMetrics(db: Database.Database, config: MetricConfig): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const metric of ALL_METRICS) {
    results[metric.name] = metric.compute(db, config);
  }
  return results;
}

export function runMetric(name: string, db: Database.Database, config: MetricConfig): unknown {
  const metric = ALL_METRICS.find((m) => m.name === name);
  if (!metric) {throw new Error(`Métrique inconnue: ${name}. Disponibles: ${ALL_METRICS.map((m) => m.name).join(", ")}`);}
  return metric.compute(db, config);
}

export { ALL_METRICS };

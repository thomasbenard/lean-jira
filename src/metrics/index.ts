import Database from "better-sqlite3";
import { MetricConfig } from "./types";
import { leadTimeMetric } from "./leadTime";
import { cycleTimeMetric } from "./cycleTime";
import { throughputMetric } from "./throughput";
import { wipMetric } from "./wip";

// Registre central. Ajouter une métrique = importer + pousser ici.
const ALL_METRICS = [leadTimeMetric, cycleTimeMetric, throughputMetric, wipMetric];

export function runAllMetrics(db: Database.Database, config: MetricConfig): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const metric of ALL_METRICS) {
    results[metric.name] = metric.compute(db, config);
  }
  return results;
}

export function runMetric(name: string, db: Database.Database, config: MetricConfig): unknown {
  const metric = ALL_METRICS.find((m) => m.name === name);
  if (!metric) throw new Error(`Métrique inconnue: ${name}. Disponibles: ${ALL_METRICS.map((m) => m.name).join(", ")}`);
  return metric.compute(db, config);
}

export { ALL_METRICS };

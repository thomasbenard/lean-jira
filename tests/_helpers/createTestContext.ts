import type Database from "better-sqlite3";
import type { MetricConfig } from "../../src/metrics/types";
import type { MetricsContext } from "../../src/metrics/context";
import { SqliteStore } from "../../src/store/sqlite";
import { buildMetricsContext } from "../../src/metrics/context";

export function createTestContext(db: Database.Database, config: MetricConfig): MetricsContext {
  return buildMetricsContext(new SqliteStore(db), config);
}

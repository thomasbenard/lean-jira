import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";

export interface WipResult {
  currentWip: number;
  issueKeys: string[];
}

export const wipMetric: Metric<WipResult> = {
  name: "wip",
  description: "Issues actuellement en cours (In Progress)",

  compute(db: Database.Database, config: MetricConfig): WipResult {
    const placeholders = config.inProgressStatuses.map(() => "?").join(",");

    const rows = db.prepare(`
      SELECT key FROM issues
      WHERE current_status IN (${placeholders})
    `).all(...config.inProgressStatuses) as Array<{ key: string }>;

    return {
      currentWip: rows.length,
      issueKeys: rows.map((r) => r.key),
    };
  },
};

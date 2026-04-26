import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";

export interface WipResult {
  currentWip: number;
  sprintName: string | null;
  issueKeys: string[];
}

export const wipMetric: Metric<WipResult> = {
  name: "wip",
  description: "Issues du sprint actif au statut 'in progress'",

  compute(db: Database.Database, config: MetricConfig): WipResult {
    const sprint = db.prepare(`
      SELECT id, name FROM sprints WHERE state = 'active' ORDER BY start_date DESC LIMIT 1
    `).get() as { id: number; name: string } | undefined;

    if (!sprint) {
      return { currentWip: 0, sprintName: null, issueKeys: [] };
    }

    const placeholders = config.inProgressStatuses.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT key FROM issues
      WHERE current_sprint_id = ? AND current_status IN (${placeholders})
    `).all(sprint.id, ...config.inProgressStatuses) as Array<{ key: string }>;

    return {
      currentWip: rows.length,
      sprintName: sprint.name,
      issueKeys: rows.map((r) => r.key),
    };
  },
};

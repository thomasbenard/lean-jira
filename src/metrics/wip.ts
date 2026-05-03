import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildExcludeIssueTypesFragment } from "./utils";

export interface WipResult {
  currentWip: number;
  sprintName: string | null;
  issueKeys: string[];
}

export const wipMetric: Metric<WipResult> = {
  name: "wip",
  description: "Travail en cours simultané (sprint actif). Limiter pour réduire le cycle-time (loi de Little).",

  compute(db: Database.Database, config: MetricConfig): WipResult {
    const sprint = db.prepare(`
      SELECT id, name FROM sprints WHERE state = 'active' ORDER BY start_date DESC LIMIT 1
    `).get() as { id: number; name: string } | undefined;

    if (!sprint) {
      return { currentWip: 0, sprintName: null, issueKeys: [] };
    }

    const placeholders = config.inProgressStatuses.map(() => "?").join(",");
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes, "");
    const rows = db.prepare(`
      SELECT key FROM issues
      WHERE current_sprint_id = ? AND current_status IN (${placeholders})
        ${excludeSql}
    `).all(sprint.id, ...config.inProgressStatuses, ...excludeArgs) as { key: string }[];

    return {
      currentWip: rows.length,
      sprintName: sprint.name,
      issueKeys: rows.map((r) => r.key),
    };
  },
};

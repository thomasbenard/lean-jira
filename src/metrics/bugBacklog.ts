import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { placeholders } from "./utils";

export interface BugBacklogResult {
  openCount: number;
  netFlow: number;
  created: number;
  closed: number;
}

export const bugBacklogMetric: Metric<BugBacklogResult> = {
  name: "bug-backlog",
  description: "Bugs ouverts (point-in-time) et flux net hebdo. Détecte si le backlog grossit.",

  compute(db: Database.Database, config: MetricConfig): BugBacklogResult {
    if (config.bugIssueTypes.length === 0) {
      return { openCount: 0, netFlow: 0, created: 0, closed: 0 };
    }

    const endDate = config.windowEndDate ?? new Date().toISOString().slice(0, 10);
    const startDate = config.cutoffDate ?? endDate;
    const bugPh = placeholders(config.bugIssueTypes);
    const donePh = config.doneStatuses.length > 0 ? placeholders(config.doneStatuses) : "";

    let openCount: number;
    if (config.doneStatuses.length === 0) {
      const row = db.prepare(`
        SELECT COUNT(*) AS c FROM issues
        WHERE issue_type IN (${bugPh})
          AND substr(created_at, 1, 10) <= ?
      `).get(...config.bugIssueTypes, endDate) as { c: number };
      openCount = row.c;
    } else {
      // Sous-requête corrélée pour garantir que to_status appartient bien à la transition MAX.
      // SELECT to_status + MAX() non-corrélé dans un GROUP BY est non-déterministe en SQLite.
      const row = db.prepare(`
        WITH last_status AS (
          SELECT t.issue_key, t.to_status
          FROM transitions t
          WHERE substr(t.transitioned_at, 1, 10) <= ?
            AND t.transitioned_at = (
              SELECT MAX(t2.transitioned_at)
              FROM transitions t2
              WHERE t2.issue_key = t.issue_key
                AND substr(t2.transitioned_at, 1, 10) <= ?
            )
        )
        SELECT COUNT(*) AS c
        FROM issues i
        LEFT JOIN last_status ls ON ls.issue_key = i.key
        WHERE i.issue_type IN (${bugPh})
          AND substr(i.created_at, 1, 10) <= ?
          AND (ls.to_status IS NULL OR ls.to_status NOT IN (${donePh}))
      `).get(endDate, endDate, ...config.bugIssueTypes, endDate, ...config.doneStatuses) as { c: number };
      openCount = row.c;
    }

    const createdRow = db.prepare(`
      SELECT COUNT(*) AS c FROM issues
      WHERE issue_type IN (${bugPh})
        AND substr(created_at, 1, 10) BETWEEN ? AND ?
    `).get(...config.bugIssueTypes, startDate, endDate) as { c: number };

    let closed = 0;
    if (config.doneStatuses.length > 0) {
      const closedRow = db.prepare(`
        WITH first_done AS (
          SELECT issue_key, MIN(transitioned_at) AS done_at
          FROM transitions
          WHERE to_status IN (${donePh})
          GROUP BY issue_key
        )
        SELECT COUNT(*) AS c
        FROM first_done fd
        JOIN issues i ON i.key = fd.issue_key
        WHERE i.issue_type IN (${bugPh})
          AND substr(fd.done_at, 1, 10) BETWEEN ? AND ?
      `).get(...config.doneStatuses, ...config.bugIssueTypes, startDate, endDate) as { c: number };
      closed = closedRow.c;
    }

    const created = createdRow.c;
    return {
      openCount,
      netFlow: closed - created,
      created,
      closed,
    };
  },
};

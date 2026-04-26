import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { percentile } from "./utils";

export interface CycleTimeResult {
  issueKey: string;
  startedAt: string;
  resolvedAt: string;
  cycleTimeDays: number;
}

export interface CycleTimeSummary {
  issues: CycleTimeResult[];
  avgDays: number;
  medianDays: number;
  p85Days: number;
  p95Days: number;
}

export const cycleTimeMetric: Metric<CycleTimeSummary> = {
  name: "cycle-time",
  description: "Temps entre premier 'In Progress' et résolution",

  compute(db: Database.Database, config: MetricConfig): CycleTimeSummary {
    const inProgressPlaceholders = config.inProgressStatuses.map(() => "?").join(",");
    const donePlaceholders = config.doneStatuses.map(() => "?").join(",");

    // Première entrée en "in progress" par issue
    const startRows = db.prepare(`
      SELECT issue_key, MIN(transitioned_at) AS started_at
      FROM transitions
      WHERE to_status IN (${inProgressPlaceholders})
      GROUP BY issue_key
    `).all(...config.inProgressStatuses) as Array<{ issue_key: string; started_at: string }>;

    // Dernière transition vers "done" par issue
    const doneRows = db.prepare(`
      SELECT issue_key, MAX(transitioned_at) AS resolved_at
      FROM transitions
      WHERE to_status IN (${donePlaceholders})
      GROUP BY issue_key
    `).all(...config.doneStatuses) as Array<{ issue_key: string; resolved_at: string }>;

    const doneMap = new Map(doneRows.map((r) => [r.issue_key, r.resolved_at]));

    const issues: CycleTimeResult[] = [];
    for (const s of startRows) {
      const resolvedAt = doneMap.get(s.issue_key);
      if (!resolvedAt) continue;
      issues.push({
        issueKey: s.issue_key,
        startedAt: s.started_at,
        resolvedAt,
        cycleTimeDays: diffDays(s.started_at, resolvedAt),
      });
    }

    const values = issues.map((i) => i.cycleTimeDays).sort((a, b) => a - b);

    return {
      issues,
      avgDays: avg(values),
      medianDays: percentile(values, 50),
      p85Days: percentile(values, 85),
      p95Days: percentile(values, 95),
    };
  },
};

function diffDays(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

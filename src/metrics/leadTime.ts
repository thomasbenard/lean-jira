import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { percentile } from "./utils";

export interface LeadTimeResult {
  issueKey: string;
  todoAt: string;
  resolvedAt: string;
  leadTimeDays: number;
}

export interface LeadTimeSummary {
  issues: LeadTimeResult[];
  avgDays: number;
  medianDays: number;
  p85Days: number;
  p95Days: number;
}

export const leadTimeMetric: Metric<LeadTimeSummary> = {
  name: "lead-time",
  description: "Temps entre entrée en colonne TODO et résolution",

  compute(db: Database.Database, config: MetricConfig): LeadTimeSummary {
    const todoPh = config.todoStatuses.map(() => "?").join(",");
    const donePh = config.doneStatuses.map(() => "?").join(",");

    const todoRows = db.prepare(`
      SELECT issue_key, MIN(transitioned_at) AS todo_at
      FROM transitions
      WHERE to_status IN (${todoPh})
      GROUP BY issue_key
    `).all(...config.todoStatuses) as Array<{ issue_key: string; todo_at: string }>;

    const doneRows = db.prepare(`
      SELECT issue_key, MAX(transitioned_at) AS resolved_at
      FROM transitions
      WHERE to_status IN (${donePh})
      GROUP BY issue_key
    `).all(...config.doneStatuses) as Array<{ issue_key: string; resolved_at: string }>;

    const doneMap = new Map(doneRows.map((r) => [r.issue_key, r.resolved_at]));

    const issues: LeadTimeResult[] = [];
    for (const t of todoRows) {
      const resolvedAt = doneMap.get(t.issue_key);
      if (!resolvedAt) continue;
      if (new Date(resolvedAt).getTime() < new Date(t.todo_at).getTime()) continue;
      issues.push({
        issueKey: t.issue_key,
        todoAt: t.todo_at,
        resolvedAt,
        leadTimeDays: diffDays(t.todo_at, resolvedAt),
      });
    }

    const values = issues.map((i) => i.leadTimeDays).sort((a, b) => a - b);

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

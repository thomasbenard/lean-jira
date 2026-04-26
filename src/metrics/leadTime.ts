import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { percentile } from "./utils";

export interface LeadTimeResult {
  issueKey: string;
  createdAt: string;
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
  description: "Temps entre création et résolution d'une issue",

  compute(db: Database.Database, config: MetricConfig): LeadTimeSummary {
    const placeholders = config.doneStatuses.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT
        i.key,
        i.created_at,
        t.transitioned_at AS resolved_at
      FROM issues i
      JOIN transitions t ON t.issue_key = i.key
      WHERE t.to_status IN (${placeholders})
      GROUP BY i.key
      HAVING t.transitioned_at = MAX(t.transitioned_at)
    `).all(...config.doneStatuses) as Array<{ key: string; created_at: string; resolved_at: string }>;

    const issues: LeadTimeResult[] = rows.map((r) => ({
      issueKey: r.key,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      leadTimeDays: diffDays(r.created_at, r.resolved_at),
    }));

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

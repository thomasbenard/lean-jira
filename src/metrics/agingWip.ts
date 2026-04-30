import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { buildDeliveredCte, percentile, placeholders, removeUpperOutliers, workingDaysBetween } from "./utils";

export type AgingRisk = "ok" | "watch" | "at-risk" | "critical";

export interface AgingWipIssue {
  issueKey: string;
  summary: string;
  status: string;
  startedAt: string;
  ageDays: number;
  riskLevel: AgingRisk;
}

export interface AgingWipSummary {
  asOf: string;
  count: number;
  // Seuils calculés sur cycle-time historique (mêmes filtres outliers).
  percentiles: { p50: number; p85: number; p95: number };
  riskCounts: { ok: number; watch: number; atRisk: number; critical: number };
  issues: AgingWipIssue[];
  unit: string;
}

export const agingWipMetric: Metric<AgingWipSummary> = {
  name: "aging-wip",
  description:
    "Âge des items en cours vs distribution cycle-time historique. Détecte les tickets qui vont rater le SLE — actionnable au stand-up.",

  compute(db: Database.Database, config: MetricConfig): AgingWipSummary {
    const nowIso = config.windowEndDate
      ? config.windowEndDate + "T23:59:59Z"
      : new Date().toISOString();
    const asOf = nowIso.slice(0, 10);

    const inProgressPh = placeholders(config.inProgressStatuses);
    const devStartPh = placeholders(config.devStartStatuses);
    const todoPh = placeholders(config.todoStatuses);

    // Items en cours à la date "asOf" : dernier statut connu avant now ∈ inProgressStatuses,
    // pas encore team-done (done_at depuis transitions, pas resolved_at Jira).
    // Pas de scoping sprint (les sprints historiques ne sont pas tracés).
    const delivered = buildDeliveredCte(config.doneStatuses);
    const items = db.prepare(`
      WITH ${delivered.cte},
      last_status AS (
        SELECT issue_key, to_status, MAX(transitioned_at) AS last_at
        FROM transitions
        WHERE transitioned_at <= ?
        GROUP BY issue_key
      ),
      first_dev AS (
        SELECT issue_key, MIN(transitioned_at) AS started_at
        FROM transitions
        WHERE to_status IN (${devStartPh})
        GROUP BY issue_key
      )
      SELECT i.key, i.summary, l.to_status AS status, fd.started_at
      FROM last_status l
      JOIN issues i ON i.key = l.issue_key
      JOIN first_dev fd ON fd.issue_key = l.issue_key
      LEFT JOIN delivered dlv ON dlv.issue_key = l.issue_key
      WHERE l.to_status IN (${inProgressPh})
        AND (dlv.done_at IS NULL OR dlv.done_at > ?)
        AND fd.started_at <= ?
    `).all(
      ...delivered.args,
      nowIso,
      ...config.devStartStatuses,
      ...config.inProgressStatuses,
      nowIso,
      nowIso,
    ) as Array<{ key: string; summary: string; status: string; started_at: string }>;

    // Percentiles historiques : population identique à cycle-time, mais bornée
    // au passé (livraison team-done avant asOf). Pas de fenêtre glissante : on
    // veut une base statistique large.
    const cutoffSql = config.cutoffDate ? "AND d.done_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];

    const histRows = db.prepare(`
      WITH ${delivered.cte}
      SELECT MIN(t.transitioned_at) AS started_at, d.done_at
      FROM transitions t
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        AND d.done_at <= ?
        ${cutoffSql}
        AND EXISTS (SELECT 1 FROM transitions t2 WHERE t2.issue_key = t.issue_key AND t2.to_status IN (${todoPh}))
      GROUP BY t.issue_key, d.done_at
    `).all(
      ...delivered.args,
      ...config.devStartStatuses,
      nowIso,
      ...cutoffArgs,
      ...config.todoStatuses,
    ) as Array<{ started_at: string; done_at: string }>;

    const histDays: number[] = [];
    for (const r of histRows) {
      if (r.done_at < r.started_at) continue;
      histDays.push(workingDaysBetween(r.started_at, r.done_at));
    }
    const { kept: cleaned } =
      config.excludeOutliers !== false
        ? removeUpperOutliers(histDays)
        : { kept: histDays };
    const sortedHist = [...cleaned].sort((a, b) => a - b);
    const p50 = percentile(sortedHist, 50);
    const p85 = percentile(sortedHist, 85);
    const p95 = percentile(sortedHist, 95);

    const issues: AgingWipIssue[] = [];
    const riskCounts = { ok: 0, watch: 0, atRisk: 0, critical: 0 };
    for (const it of items) {
      const age = workingDaysBetween(it.started_at, nowIso);
      let risk: AgingRisk;
      if (sortedHist.length === 0) {
        risk = "ok";
        riskCounts.ok++;
      } else if (age > p95) {
        risk = "critical";
        riskCounts.critical++;
      } else if (age > p85) {
        risk = "at-risk";
        riskCounts.atRisk++;
      } else if (age > p50) {
        risk = "watch";
        riskCounts.watch++;
      } else {
        risk = "ok";
        riskCounts.ok++;
      }
      issues.push({
        issueKey: it.key,
        summary: it.summary,
        status: it.status,
        startedAt: it.started_at,
        ageDays: age,
        riskLevel: risk,
      });
    }

    issues.sort((a, b) => b.ageDays - a.ageDays);

    return {
      asOf,
      count: issues.length,
      percentiles: { p50, p85, p95 },
      riskCounts,
      issues,
      unit: "j",
    };
  },
};

import { type Metric } from "./types";
import type { MetricsContext } from "./context";
import { percentile, removeUpperOutliers } from "./utils";
import { now } from "../clock";

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

interface WipItem {
  key: string;
  summary: string;
  status: string;
  startedAt: string;
}

export const agingWipMetric: Metric<AgingWipSummary> = {
  name: "aging-wip",
  description:
    "Âge des items en cours vs distribution cycle-time historique. Détecte les tickets qui vont rater le SLE — actionnable au stand-up.",

  compute(ctx: MetricsContext): AgingWipSummary {
    const config = ctx.config;
    const nowIso = config.windowEndDate
      ? config.windowEndDate + "T23:59:59Z"
      : now().toISOString();
    const asOf = nowIso.slice(0, 10);

    const inProgressSet = new Set(config.inProgressStatuses);
    const devStartSet = new Set(config.devStartStatuses);

    // Items en cours à la date "asOf" : dernier statut connu avant nowIso ∈ inProgressStatuses,
    // pas encore team-done (deliveredAt absent ou postérieur à nowIso).
    const items: WipItem[] = [];
    for (const issue of ctx.issues) {
      const transitions = ctx.transitionsByIssue.get(issue.key) ?? [];
      let lastTransition = null;
      for (let i = transitions.length - 1; i >= 0; i--) {
        if (transitions[i].transitionedAt <= nowIso) {
          lastTransition = transitions[i];
          break;
        }
      }
      if (!lastTransition) { continue; }
      if (!inProgressSet.has(lastTransition.toStatus)) { continue; }

      const firstDev = transitions.find((t) => devStartSet.has(t.toStatus));
      if (!firstDev) { continue; }
      if (firstDev.transitionedAt > nowIso) { continue; }

      const doneAt = ctx.deliveredAt.get(issue.key);
      if (doneAt && doneAt <= nowIso) { continue; }

      items.push({
        key: issue.key,
        summary: issue.summary,
        status: lastTransition.toStatus,
        startedAt: firstDev.transitionedAt,
      });
    }

    // Percentiles historiques : population identique à cycle-time. Le filtre
    // windowEndDate de ctx.cycleTimePopulation borne déjà le passé.
    const histDays: number[] = [];
    for (const sample of ctx.cycleTimePopulation) {
      histDays.push(ctx.workingDaysBetween(sample.startedAt, sample.doneAt));
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
      const age = ctx.workingDaysBetween(it.startedAt, nowIso);
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
        startedAt: it.startedAt,
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

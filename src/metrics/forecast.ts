import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildDeliveredCte, buildExcludeIssueTypesFragment, percentile } from "./utils";
import { random } from "../random";

export interface ForecastHorizon {
  weeks: number;
  // Percentiles de la distribution simulée du nombre total d'issues livrées.
  // p15 = engagement à 85% de confiance ("85% des sims livrent au moins ce nombre").
  // p50 = livraison médiane attendue. p85 = optimiste. p95 = quasi-plafond.
  p15: number;
  p50: number;
  p85: number;
  p95: number;
}

export interface ForecastSummary {
  recentWeeks: number[]; // pool d'échantillonnage chronologique (semaines récentes)
  weeksUsed: number;
  byHorizon: ForecastHorizon[];
  simulations: number;
  unit: string;
}

const SIM_COUNT = 10_000;
const HISTORY_WEEKS = 12;
const HORIZONS = [1, 2, 4, 8];

export const forecastMetric: Metric<ForecastSummary> = {
  name: "forecast",
  description:
    "Forecast Monte Carlo. Tire 10k simulations sur 12 dernières semaines de throughput. Donne, par horizon (1/2/4/8 semaines), la fourchette de livraison à différents niveaux de confiance.",

  compute(db: Database.Database, config: MetricConfig): ForecastSummary {
    // Volontairement sans filtre cutoffDate : LIMIT 12 borne déjà l'historique
    // utilisé. Permet aux snapshots historiques de ne pas se retrouver avec
    // 4 semaines de données quand le cutoff snapshot est de 30j.
    const delivered = buildDeliveredCte(config.doneStatuses);
    const endSql = config.windowEndDate ? "AND d.done_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];
    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    const rows = db.prepare(`
      WITH ${delivered.cte}
      SELECT strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week, COUNT(*) AS c
      FROM delivered d
      JOIN issues i ON i.key = d.issue_key
      WHERE 1=1 ${excludeSql} ${endSql}
      GROUP BY week
      ORDER BY week DESC
      LIMIT ?
    `).all(...delivered.args, ...excludeArgs, ...endArgs, HISTORY_WEEKS) as { week: string; c: number }[];

    const samples = rows.map((r) => r.c).reverse();
    if (samples.length === 0) {
      return {
        recentWeeks: [],
        weeksUsed: 0,
        byHorizon: [],
        simulations: 0,
        unit: "issues",
      };
    }

    const byHorizon: ForecastHorizon[] = HORIZONS.map((weeks) => {
      const totals = new Array<number>(SIM_COUNT);
      for (let s = 0; s < SIM_COUNT; s++) {
        let total = 0;
        for (let w = 0; w < weeks; w++) {
          total += samples[Math.floor(random() * samples.length)];
        }
        totals[s] = total;
      }
      totals.sort((a, b) => a - b);
      return {
        weeks,
        p15: percentile(totals, 15),
        p50: percentile(totals, 50),
        p85: percentile(totals, 85),
        p95: percentile(totals, 95),
      };
    });

    return {
      recentWeeks: samples,
      weeksUsed: samples.length,
      byHorizon,
      simulations: SIM_COUNT,
      unit: "issues",
    };
  },
};

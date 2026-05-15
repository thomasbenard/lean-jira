import { type Metric } from "./types";
import { percentile } from "./utils";
import { random } from "../random";
import type { MetricsContext } from "./context";

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

  compute(ctx: MetricsContext): ForecastSummary {
    // Volontairement sans filtre cutoffDate : LIMIT 12 borne déjà l'historique
    // utilisé. Permet aux snapshots historiques de ne pas se retrouver avec
    // 4 semaines de données quand le cutoff snapshot est de 30j.
    const windowEnd = ctx.config.windowEndDate;
    const countsByWeek = new Map<string, number>();
    for (const doneAt of ctx.deliveredAt.values()) {
      // pourquoi : reproduit la comparaison lexicographique de SQLite
      // (`done_at <= ?`) — un `done_at` du jour même que `windowEndDate`
      // est exclu (préfixe identique mais plus long → lex-greater).
      if (windowEnd && doneAt > windowEnd) { continue; }
      const week = ctx.isoWeek(doneAt);
      countsByWeek.set(week, (countsByWeek.get(week) ?? 0) + 1);
    }

    const sortedWeeks = [...countsByWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const samples = sortedWeeks.slice(0, HISTORY_WEEKS).map(([, c]) => c).reverse();
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

import type { ReadStore, IssueRecord, TransitionRecord } from "../store/types";
import type { MetricConfig } from "./types";
import { isoWeek, workingDaysBetween } from "./utils";

export interface CycleTimeSample {
  issueKey: string;
  startedAt: string;
  doneAt: string;
}

export interface MetricsContext {
  issues: IssueRecord[];
  transitions: TransitionRecord[];

  issueByKey: Map<string, IssueRecord>;
  transitionsByIssue: Map<string, TransitionRecord[]>;
  transitionsByToStatus: Map<string, TransitionRecord[]>;

  deliveredAt: Map<string, string>;
  cycleTimePopulation: CycleTimeSample[];

  workingDaysBetween: typeof workingDaysBetween;
  isoWeek: typeof isoWeek;

  config: MetricConfig;
  store: ReadStore;
}

// pourquoi : partie stable du contexte, indépendante de cutoffDate/windowEndDate.
// Construite une seule fois par run de backfill ; les `deriveMetricsContext`
// successifs réutilisent les Maps et indexes (identity preservée).
export interface BaseMetricsContext {
  issues: IssueRecord[];
  transitions: TransitionRecord[];
  issueByKey: Map<string, IssueRecord>;
  transitionsByIssue: Map<string, TransitionRecord[]>;
  transitionsByToStatus: Map<string, TransitionRecord[]>;
  deliveredAt: Map<string, string>;
  // Population complète sans filtre cutoff/windowEnd ; filtrée à la dérivation.
  allCycleTimeSamples: CycleTimeSample[];
  store: ReadStore;
}

export function buildBaseMetricsContext(store: ReadStore, config: MetricConfig): BaseMetricsContext {
  const excludeSet = new Set(config.excludeIssueTypes);
  const issues = store.issues.all().filter((i) => !excludeSet.has(i.issueType));
  const issueKeys = new Set(issues.map((i) => i.key));

  const allTransitions = store.transitions.all();
  const transitions = allTransitions.filter((t) => issueKeys.has(t.issueKey));

  const issueByKey = new Map<string, IssueRecord>();
  for (const i of issues) { issueByKey.set(i.key, i); }

  const transitionsByIssue = new Map<string, TransitionRecord[]>();
  const transitionsByToStatus = new Map<string, TransitionRecord[]>();
  for (const t of transitions) {
    let perIssue = transitionsByIssue.get(t.issueKey);
    if (!perIssue) {
      perIssue = [];
      transitionsByIssue.set(t.issueKey, perIssue);
    }
    perIssue.push(t);
    let perStatus = transitionsByToStatus.get(t.toStatus);
    if (!perStatus) {
      perStatus = [];
      transitionsByToStatus.set(t.toStatus, perStatus);
    }
    perStatus.push(t);
  }
  // pourquoi : garantir l'ordre chronologique par issue (suit l'ordre du SELECT mais on rebuild)
  for (const list of transitionsByIssue.values()) {
    list.sort((a, b) => a.transitionedAt.localeCompare(b.transitionedAt) || a.id - b.id);
  }

  const doneSet = new Set(config.doneStatuses);
  const deliveredAt = new Map<string, string>();
  for (const [key, list] of transitionsByIssue) {
    const first = list.find((t) => doneSet.has(t.toStatus));
    if (first) { deliveredAt.set(key, first.transitionedAt); }
  }

  const devStartSet = new Set(config.devStartStatuses);
  const allCycleTimeSamples: CycleTimeSample[] = [];
  for (const [key, list] of transitionsByIssue) {
    const doneAt = deliveredAt.get(key);
    if (!doneAt) { continue; }
    const devStart = list.find((t) => devStartSet.has(t.toStatus));
    if (!devStart) { continue; }
    allCycleTimeSamples.push({ issueKey: key, startedAt: devStart.transitionedAt, doneAt });
  }
  allCycleTimeSamples.sort((a, b) => a.issueKey.localeCompare(b.issueKey));

  return {
    issues, transitions,
    issueByKey, transitionsByIssue, transitionsByToStatus,
    deliveredAt, allCycleTimeSamples,
    store,
  };
}

export function deriveMetricsContext(base: BaseMetricsContext, config: MetricConfig): MetricsContext {
  const cutoff = config.cutoffDate;
  const windowEnd = config.windowEndDate;
  const cycleTimePopulation: CycleTimeSample[] = [];
  for (const s of base.allCycleTimeSamples) {
    if (cutoff && s.doneAt < cutoff) { continue; }
    if (windowEnd && s.doneAt > windowEnd) { continue; }
    cycleTimePopulation.push(s);
  }

  return {
    issues: base.issues,
    transitions: base.transitions,
    issueByKey: base.issueByKey,
    transitionsByIssue: base.transitionsByIssue,
    transitionsByToStatus: base.transitionsByToStatus,
    deliveredAt: base.deliveredAt,
    cycleTimePopulation,
    workingDaysBetween, isoWeek,
    config, store: base.store,
  };
}

export function buildMetricsContext(store: ReadStore, config: MetricConfig): MetricsContext {
  return deriveMetricsContext(buildBaseMetricsContext(store, config), config);
}

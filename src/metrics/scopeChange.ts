import { type Metric } from "./types";
import type { MetricsContext } from "./context";
import type { IssueFieldChangeRecord } from "../store/types";

export interface ScopeChangedIssueDetail {
  key: string;
  description: boolean;
}

export interface SprintScopeStats {
  totalIssues: number;
  changedIssues: number;
  changeRatio: number;
  byChangeType: {
    description: number;
  };
  issueDetails: ScopeChangedIssueDetail[];
}

export interface ScopeChangeResult {
  totalIssues: number;
  changedIssues: number;
  changeRatio: number;
  bySprint: Partial<Record<string, SprintScopeStats>>;
  changedIssueKeys: string[];
}

const SIMILARITY_THRESHOLD = 0.85;
const WATCHED_TEXT_FIELDS = ["description", "summary"] as const;
const WATCHED_TEXT_FIELDS_SET: ReadonlySet<string> = new Set(WATCHED_TEXT_FIELDS);
const FIELD_SPRINT = "Sprint";

interface FieldState { first: string; last: string }

export function normalizeText(s: string): string {
  return s
    .replace(/\{[^}]*\}/g, " ")
    .replace(/![^!\s][^!]*!/g, " ")
    .replace(/\[([^\]|]+)\|[^\]]+\]/g, "$1")
    .toLowerCase()
    .replace(/[*_#>`~\[\]()]/g, " ")
    .replace(/`{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

export function similarityRatio(from: string, to: string): number {
  const a = normalizeText(from);
  const b = normalizeText(to);
  if (a.length === 0) {return b.length === 0 ? 1 : 0;}
  // Dénominateur = longueur du texte original : ajout de N% → sim = 1-N%, détecté si N > ~15%.
  return Math.max(0, 1 - levenshtein(a, b) / a.length);
}

function findFirstSprint(
  changes: IssueFieldChangeRecord[],
  sprintStartByName: Map<string, string>,
): string | null {
  let firstSprintStart: string | null = null;
  let firstSprintName: string | null = null;

  for (const c of changes) {
    if (c.fieldName !== FIELD_SPRINT || !c.toValue) {continue;}
    for (const [name, start] of sprintStartByName) {
      if (c.toValue.includes(name) && (!firstSprintStart || start < firstSprintStart)) {
        firstSprintStart = start;
        firstSprintName = name;
      }
    }
  }

  return firstSprintName;
}

function emptySprintStats(): SprintScopeStats {
  return {
    totalIssues: 0,
    changedIssues: 0,
    changeRatio: 0,
    byChangeType: { description: 0 },
    issueDetails: [],
  };
}

export const scopeChangeMetric: Metric<ScopeChangeResult> = {
  name: "scope-change-rate",
  description: "Taux d'issues dont la description ou le résumé a changé après entrée en sprint. Mesure la dérive de périmètre.",

  compute(ctx: MetricsContext): ScopeChangeResult {
    const config = ctx.config;
    const cutoff = config.cutoffDate ?? "1970-01-01";

    const filteredSprints = ctx.store.sprints.all().filter(
      (s) => s.startDate !== null && s.startDate >= cutoff,
    );
    const sprintStartByName = new Map(filteredSprints.map((s) => [s.name, s.startDate as string]));

    // Limité aux issues ayant un changelog Sprint : seule façon de dériver firstSprintStart.
    // Limitation connue : une issue créée directement dans un sprint (sans changelog Sprint)
    // sera comptée dans totalIssues mais exclue du scan de dérive de périmètre.
    // pourquoi : ctx.issueByKey est déjà filtré par excludeIssueTypes en amont (buildMetricsContext)
    const byIssue = new Map<string, IssueFieldChangeRecord[]>();
    for (const issueKey of ctx.issueByKey.keys()) {
      const sprintChanges = ctx.store.issueFieldChanges.byIssueAndField(issueKey, FIELD_SPRINT);
      if (sprintChanges.length === 0) {continue;}
      const all: IssueFieldChangeRecord[] = [...sprintChanges];
      for (const field of WATCHED_TEXT_FIELDS) {
        all.push(...ctx.store.issueFieldChanges.byIssueAndField(issueKey, field));
      }
      all.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
      byIssue.set(issueKey, all);
    }

    const bySprint: Partial<Record<string, SprintScopeStats>> = {};
    const changedIssueKeys: string[] = [];
    let totalIssues = 0;
    let changedIssues = 0;

    // issue_sprints (customfield_10020) contient l'effectif réel — inclut les issues créées directement dans le sprint sans passer par un changelog Sprint.
    // pourquoi : plusieurs sprints peuvent partager le même nom dans les fixtures de test → on somme les counts par nom.
    for (const sprint of filteredSprints) {
      const count = ctx.store.issueSprints
        .bySprint(sprint.id)
        .filter((rec) => ctx.issueByKey.has(rec.issueKey))
        .length;
      if (count === 0) {continue;}
      const sprintStats = bySprint[sprint.name] ?? emptySprintStats();
      bySprint[sprint.name] = sprintStats;
      sprintStats.totalIssues += count;
      totalIssues += count; // une issue dans N sprints compte N fois — intentionnel pour que changeRatio soit cohérent par sprint
    }

    const devStartSet = new Set(config.devStartStatuses);
    const gracePeriodMs = (config.scopeChangeGracePeriodHours ?? 0) * 3_600_000;

    for (const [issueKey, changes] of byIssue) {
      const firstSprintName = findFirstSprint(changes, sprintStartByName);
      if (!firstSprintName) {continue;}
      // bySprint absent = sprint non dans issue_sprints → issue hors périmètre (ex. sprint sans start_date)
      const currentSprintStats = bySprint[firstSprintName];
      if (!currentSprintStats) {continue;}

      const firstDev = ctx.transitionsByIssue.get(issueKey)?.find((t) => devStartSet.has(t.toStatus));
      if (!firstDev) {continue;}

      const graceCutoff = new Date(Date.parse(firstDev.transitionedAt) + gracePeriodMs).toISOString();

      const fieldStates = new Map<string, FieldState>();

      for (const c of changes) {
        if (c.changedAt <= graceCutoff) {continue;}
        if (!WATCHED_TEXT_FIELDS_SET.has(c.fieldName) || c.fromValue === null) {continue;}
        if (!fieldStates.has(c.fieldName)) {
          fieldStates.set(c.fieldName, { first: c.fromValue, last: c.toValue ?? "" });
        } else {
          const state = fieldStates.get(c.fieldName);
          if (state) {state.last = c.toValue ?? "";}
        }
      }

      let descriptionChanged = false;
      for (const { first, last } of fieldStates.values()) {
        if (similarityRatio(first, last) < SIMILARITY_THRESHOLD) {
          descriptionChanged = true;
          break;
        }
      }

      if (descriptionChanged) {
        changedIssues++;
        changedIssueKeys.push(issueKey);
        currentSprintStats.changedIssues++;
        currentSprintStats.byChangeType.description++;
        currentSprintStats.issueDetails.push({ key: issueKey, description: true });
      }
    }

    for (const stats of Object.values(bySprint)) {
      if (!stats) {continue;}
      stats.changeRatio = stats.totalIssues > 0 ? stats.changedIssues / stats.totalIssues : 0;
    }

    return {
      totalIssues,
      changedIssues,
      changeRatio: totalIssues > 0 ? changedIssues / totalIssues : 0,
      bySprint,
      changedIssueKeys,
    };
  },
};

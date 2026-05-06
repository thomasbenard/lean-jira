import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { placeholders } from "./utils";

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
  bySprint: Record<string, SprintScopeStats>;
  changedIssueKeys: string[];
}

const SIMILARITY_THRESHOLD = 0.85;
const WATCHED_TEXT_FIELDS = new Set(["description", "summary"]);
const FIELD_SPRINT = "Sprint";

export function normalizeText(s: string): string {
  return s
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
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {return 1;}
  return 1 - levenshtein(a, b) / maxLen;
}

type FieldChangeRow = {
  issue_key: string;
  field_name: string;
  from_value: string | null;
  to_value: string | null;
  changed_at: string;
};

function findFirstSprint(
  changes: FieldChangeRow[],
  sprintStartByName: Map<string, string>,
): { firstSprintName: string | null; firstSprintStart: string | null } {
  let firstSprintStart: string | null = null;
  let firstSprintName: string | null = null;

  for (const c of changes) {
    if (c.field_name !== FIELD_SPRINT || !c.to_value) {continue;}
    for (const [name, start] of sprintStartByName) {
      if (c.to_value.includes(name) && (!firstSprintStart || start < firstSprintStart)) {
        firstSprintStart = start;
        firstSprintName = name;
      }
    }
  }

  return { firstSprintName, firstSprintStart };
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

  compute(db: Database.Database, config: MetricConfig): ScopeChangeResult {
    const cutoff = config.cutoffDate ?? "1970-01-01";
    const sprintRows = db.prepare(
      "SELECT name, start_date FROM sprints WHERE start_date IS NOT NULL AND start_date >= ?",
    ).all(cutoff) as { name: string; start_date: string }[];
    const sprintStartByName = new Map(sprintRows.map((s) => [s.name, s.start_date]));

    const excluded = config.excludeIssueTypes ?? [];
    const excludeClause = excluded.length > 0
      ? `AND i.issue_type NOT IN (${placeholders(excluded)})`
      : "";

    // Limité aux issues ayant un changelog Sprint : seule façon de dériver firstSprintStart.
    // Limitation connue : une issue créée directement dans un sprint (sans changelog Sprint)
    // sera comptée dans totalIssues mais exclue du scan de dérive de périmètre.
    const allChanges = db.prepare(`
      SELECT f.issue_key, f.field_name, f.from_value, f.to_value, f.changed_at
      FROM issue_field_changes f
      JOIN issues i ON i.key = f.issue_key
      WHERE f.issue_key IN (
        SELECT DISTINCT issue_key FROM issue_field_changes WHERE field_name = 'Sprint'
      )
      ${excludeClause}
      ORDER BY f.issue_key, f.changed_at
    `).all(...excluded) as FieldChangeRow[];

    const byIssue = new Map<string, FieldChangeRow[]>();
    for (const row of allChanges) {
      if (!byIssue.has(row.issue_key)) {byIssue.set(row.issue_key, []);}
      byIssue.get(row.issue_key)!.push(row);
    }

    const bySprint: Record<string, SprintScopeStats> = {};
    const changedIssueKeys: string[] = [];
    let totalIssues = 0;
    let changedIssues = 0;

    // issue_sprints (customfield_10020) contient l'effectif réel — inclut les issues créées directement dans le sprint sans passer par un changelog Sprint
    const totalsRows = db.prepare(`
      SELECT s.name AS sprint_name, COUNT(DISTINCT isp.issue_key) AS cnt
      FROM issue_sprints isp
      JOIN issues i ON i.key = isp.issue_key
      JOIN sprints s ON s.id = isp.sprint_id
      WHERE s.start_date IS NOT NULL AND s.start_date >= ?
      ${excludeClause}
      GROUP BY s.name
    `).all(cutoff, ...excluded) as { sprint_name: string; cnt: number }[];

    for (const row of totalsRows) {
      if (!bySprint[row.sprint_name]) {bySprint[row.sprint_name] = emptySprintStats();}
      bySprint[row.sprint_name].totalIssues = row.cnt;
      totalIssues += row.cnt; // une issue dans N sprints compte N fois — intentionnel pour que changeRatio soit cohérent par sprint
    }

    for (const [issueKey, changes] of byIssue) {
      const { firstSprintName, firstSprintStart } = findFirstSprint(changes, sprintStartByName);
      // bySprint absent = sprint non dans issue_sprints → issue hors périmètre (ex. sprint sans start_date)
      if (!firstSprintStart || !firstSprintName || !bySprint[firstSprintName]) {continue;}

      let descriptionChanged = false;

      for (const c of changes) {
        if (c.changed_at <= firstSprintStart) {continue;}
        if (WATCHED_TEXT_FIELDS.has(c.field_name) && c.from_value !== null) {
          if (similarityRatio(c.from_value, c.to_value ?? "") < SIMILARITY_THRESHOLD) {
            descriptionChanged = true;
            break;
          }
        }
      }

      if (descriptionChanged) {
        changedIssues++;
        changedIssueKeys.push(issueKey);
        bySprint[firstSprintName].changedIssues++;
        bySprint[firstSprintName].byChangeType.description++;
        bySprint[firstSprintName].issueDetails.push({ key: issueKey, description: true });
      }
    }

    for (const stats of Object.values(bySprint)) {
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

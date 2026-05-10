import type Database from "better-sqlite3";
import type { EstimationConfig, EstimationBucketThresholds, EstimationMethod, MetricConfig } from "./types";

export interface TransitionRow {
  key: string;
  done_at: string;
  started_at: string;
  to_status: string;
  transitioned_at: string;
}

export interface RoleStatuses {
  devStatuses: string[];
  qaStatuses: string[];
  poStatuses: string[];
}

// Jours ouvrés (lun-ven) entre deux timestamps ISO. Fraction de journée incluse
// si elle tombe un jour ouvré. Fenêtres de snapshot restent en calendaire.
export function workingDaysBetween(from: string, to: string): number {
  const startMs = new Date(from).getTime();
  const endMs = new Date(to).getTime();
  if (endMs <= startMs) {return 0;}

  const calDays = (endMs - startMs) / 86_400_000;
  const wholeDays = Math.floor(calDays);
  const frac = calDays - wholeDays;

  const startDow = new Date(from).getDay(); // 0=dim, 6=sam
  const fullWeeks = Math.floor(wholeDays / 7);
  const rem = wholeDays % 7;

  let extraWorking = 0;
  for (let i = 0; i < rem; i++) {
    const d = (startDow + i) % 7;
    if (d !== 0 && d !== 6) {extraWorking++;}
  }

  const partialDow = (startDow + wholeDays) % 7;
  const fracWorking = (partialDow !== 0 && partialDow !== 6) ? frac : 0;

  return fullWeeks * 5 + extraWorking + fracWorking;
}

// Tableau doit être trié en ordre croissant
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) {return 0;}
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

// 1 jour-personne = 8h = 28800 secondes (convention Atlassian par défaut)
export const SECONDS_PER_DAY = 28800;

// CTE SQL qui calcule done_at par issue = 1ère transition vers un statut "done"
// (statusCategory.key='done' ∪ config.doneStatuses pour les statuts renommés).
// Remplace issues.resolved_at (champ resolutiondate Jira) côté métriques de durée :
// définit la "livraison" du point de vue équipe (ex: passage en "À valider"
// = team-done sur le board KECK) au lieu du statut "Done" final.
//
// Usage :
//   const d = buildDeliveredCte(config.doneStatuses);
//   db.prepare(`WITH ${d.cte} SELECT ... JOIN delivered ON ...`).all(...d.args, ...);
export function buildDeliveredCte(doneStatuses: string[]): { cte: string; args: string[] } {
  const ph = doneStatuses.map(() => "?").join(",");
  return {
    cte: `delivered AS (
      SELECT issue_key, MIN(transitioned_at) AS done_at
      FROM transitions
      WHERE to_status IN (${ph})
      GROUP BY issue_key
    )`,
    args: [...doneStatuses],
  };
}

export function placeholders(arr: unknown[]): string {
  return arr.map(() => "?").join(",");
}

// Assume delivered CTE aliased as 'd' in calling query.
export function buildWindowFragment(
  cutoffDate: string | undefined,
  windowEndDate: string | undefined,
): { cutoffSql: string; cutoffArgs: string[]; endSql: string; endArgs: string[] } {
  return {
    cutoffSql: cutoffDate ? "AND d.done_at >= ?" : "",
    cutoffArgs: cutoffDate ? [cutoffDate] : [],
    endSql: windowEndDate ? "AND d.done_at <= ?" : "",
    endArgs: windowEndDate ? [windowEndDate] : [],
  };
}

export function buildExcludeIssueTypesFragment(
  excludeIssueTypes: string[],
  alias = "i",
): { excludeSql: string; excludeArgs: string[] } {
  if (excludeIssueTypes.length === 0) {return { excludeSql: "", excludeArgs: [] };}
  const col = alias ? `${alias}.issue_type` : "issue_type";
  return {
    excludeSql: `AND ${col} NOT IN (${placeholders(excludeIssueTypes)})`,
    excludeArgs: [...excludeIssueTypes],
  };
}

export function buildBugExclusionFragment(bugIssueTypes: string[]): { bugSql: string; bugArgs: string[] } {
  if (bugIssueTypes.length === 0) {return { bugSql: "", bugArgs: [] };}
  return {
    bugSql: `AND i.issue_type NOT IN (${placeholders(bugIssueTypes)})`,
    bugArgs: [...bugIssueTypes],
  };
}

export type SizeBucket = "XS" | "S" | "M" | "L" | "XL" | "BUG" | "UNESTIMATED";

export const BUCKET_ORDER: SizeBucket[] = ["XS", "S", "M", "L", "XL", "BUG", "UNESTIMATED"];

export const BUCKET_LABELS: Record<SizeBucket, string> = {
  XS: "XS (<0.5j)",
  S: "S (0.5-1j)",
  M: "M (1-3j)",
  L: "L (3-5j)",
  XL: "XL (≥5j)",
  BUG: "BUG",
  UNESTIMATED: "UNESTIMATED",
};

const DEFAULT_THRESHOLDS: Partial<Record<EstimationMethod, EstimationBucketThresholds>> = {
  time:            { xs: 0.5, s: 1, m: 3,  l: 5  },
  "story-points":  { xs: 1,   s: 3, m: 8,  l: 13 },
};

function resolveThresholds(estimation: EstimationConfig): EstimationBucketThresholds {
  const defaults = DEFAULT_THRESHOLDS[estimation.method];
  if (!defaults && !estimation.bucketThresholds) {
    throw new Error(`metrics.estimation.method="${estimation.method}" requiert bucketThresholds`);
  }
  return { ...defaults, ...estimation.bucketThresholds } as EstimationBucketThresholds;
}

function applyThresholds(value: number, t: EstimationBucketThresholds): SizeBucket {
  if (value < t.xs) {return "XS";}
  if (value < t.s) {return "S";}
  if (value < t.m) {return "M";}
  if (value < t.l) {return "L";}
  return "XL";
}

export interface IssueEstimation {
  originalEstimateSeconds: number | null | undefined;
  storyPoints: number | null | undefined;
  sizeLabel: string | null | undefined;
}

export function bucketize(issue: IssueEstimation, isBug: boolean, estimation: EstimationConfig): SizeBucket {
  if (isBug) {return "BUG";}

  const { method } = estimation;

  if (method === "none") {return "UNESTIMATED";}

  if (method === "t-shirt") {
    return (issue.sizeLabel as SizeBucket | null) ?? "UNESTIMATED";
  }

  if (method === "story-points" || method === "numeric") {
    if (issue.storyPoints == null || issue.storyPoints <= 0) {return "UNESTIMATED";}
    return applyThresholds(issue.storyPoints, resolveThresholds(estimation));
  }

  const sec = issue.originalEstimateSeconds;
  if (sec == null || sec <= 0) {return "UNESTIMATED";}
  return applyThresholds(sec / SECONDS_PER_DAY, resolveThresholds(estimation));
}

export function getBucketLabels(estimation: EstimationConfig): Record<SizeBucket, string> {
  const { method } = estimation;

  if (method === "t-shirt") {
    return { XS: "XS", S: "S", M: "M", L: "L", XL: "XL", BUG: "BUG", UNESTIMATED: "UNESTIMATED" };
  }

  if (method === "none") {
    return { XS: "UNESTIMATED", S: "UNESTIMATED", M: "UNESTIMATED", L: "UNESTIMATED",
      XL: "UNESTIMATED", BUG: "BUG", UNESTIMATED: "UNESTIMATED" };
  }

  if (method === "story-points" || method === "numeric") {
    const t = resolveThresholds(estimation);
    const unit = method === "story-points" ? " SP" : "";
    return {
      XS: `XS (<${t.xs}${unit})`,
      S:  `S (${t.xs}-${t.s}${unit})`,
      M:  `M (${t.s}-${t.m}${unit})`,
      L:  `L (${t.m}-${t.l}${unit})`,
      XL: `XL (≥${t.l}${unit})`,
      BUG: "BUG",
      UNESTIMATED: "UNESTIMATED",
    };
  }

  // "time" : labels existants
  return BUCKET_LABELS;
}

export function avg(values: number[]): number {
  if (values.length === 0) {return 0;}
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface DurationStats {
  count: number;
  excludedOutliers: number;
  avgDays: number;
  medianDays: number;
  p85Days: number;
  p95Days: number;
}

// Tukey upper fence: Q3 + 1.5 * IQR, queue droite seulement (cycle-time >= 0).
// Conserve la médiane et P85 stables, retire les valeurs extrêmes qui tirent la moyenne.
export function removeUpperOutliers(values: number[]): { kept: number[]; excluded: number } {
  if (values.length < 4) {return { kept: [...values].sort((a, b) => a - b), excluded: 0 };}
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const upper = q3 + 1.5 * iqr;
  const kept = sorted.filter((v) => v <= upper);
  return { kept, excluded: sorted.length - kept.length };
}

export function statsFromDays(days: number[], excludeOutliers = true): DurationStats {
  let kept: number[];
  let excluded: number;
  if (excludeOutliers) {
    ({ kept, excluded } = removeUpperOutliers(days)); // kept already sorted by removeUpperOutliers
  } else {
    kept = [...days].sort((a, b) => a - b);
    excluded = 0;
  }
  return {
    count: kept.length,
    excludedOutliers: excluded,
    avgDays: avg(kept),
    medianDays: percentile(kept, 50),
    p85Days: percentile(kept, 85),
    p95Days: percentile(kept, 95),
  };
}

export function toRoleStatuses(config: MetricConfig): RoleStatuses {
  return {
    devStatuses: config.devStatuses ?? [],
    qaStatuses: config.qaStatuses ?? [],
    poStatuses: config.poStatuses ?? [],
  };
}

export function fetchDeliveredTransitions(
  db: Database.Database,
  config: MetricConfig,
): TransitionRow[] {
  const todoPh = placeholders(config.todoStatuses);
  const devStartPh = placeholders(config.devStartStatuses);
  const delivered = buildDeliveredCte(config.doneStatuses);
  const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(
    config.cutoffDate, config.windowEndDate,
  );
  const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(
    config.excludeIssueTypes,
  );

  return db.prepare(`
    WITH ${delivered.cte},
    eligible AS (
      SELECT i.key, d.done_at, MIN(t.transitioned_at) AS started_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${excludeSql} ${cutoffSql} ${endSql}
        AND EXISTS (
          SELECT 1 FROM transitions t2
          WHERE t2.issue_key = t.issue_key
            AND t2.to_status IN (${todoPh})
        )
      GROUP BY i.key, d.done_at
    )
    SELECT e.key, e.done_at, e.started_at, tr.to_status, tr.transitioned_at
    FROM eligible e
    JOIN transitions tr ON tr.issue_key = e.key
      AND tr.transitioned_at >= e.started_at
      AND tr.transitioned_at <= e.done_at
    ORDER BY e.key ASC, tr.transitioned_at ASC, tr.id ASC
  `).all(
    ...delivered.args,
    ...config.devStartStatuses,
    ...excludeArgs,
    ...cutoffArgs,
    ...endArgs,
    ...config.todoStatuses,
  ) as TransitionRow[];
}

// Retourne la semaine ISO (ex: "2025-W10") d'un timestamp ISO.
// Le jeudi détermine l'année ISO (règle ISO 8601).
export function isoWeek(dateISO: string): string {
  const d = new Date(dateISO.length <= 10 ? dateISO + "T00:00:00Z" : dateISO);
  const day = d.getUTCDay() || 7; // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

export function groupByIssue(rows: TransitionRow[]): Map<string, TransitionRow[]> {
  const map = new Map<string, TransitionRow[]>();
  for (const row of rows) {
    let list = map.get(row.key);
    if (!list) {
      list = [];
      map.set(row.key, list);
    }
    list.push(row);
  }
  return map;
}

export function computeRoleDays(
  transitions: TransitionRow[],
  done_at: string,
  roles: RoleStatuses,
): { devDays: number; qaDays: number; poDays: number } {
  let devDays = 0;
  let qaDays = 0;
  let poDays = 0;

  for (let i = 0; i < transitions.length; i++) {
    const start = transitions[i].transitioned_at;
    const end = i + 1 < transitions.length
      ? transitions[i + 1].transitioned_at
      : done_at;
    if (end <= start) {continue;}
    const days = workingDaysBetween(start, end);
    const status = transitions[i].to_status;
    if (roles.devStatuses.includes(status)) {devDays += days;}
    else if (roles.qaStatuses.includes(status)) {qaDays += days;}
    else if (roles.poStatuses.includes(status)) {poDays += days;}
  }

  return { devDays, qaDays, poDays };
}

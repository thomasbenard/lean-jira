import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { fetchDeliveredTransitions, groupByIssue, workingDaysBetween } from "./utils";
import type { TransitionRow } from "./utils";
import { distributeAcrossWeeks } from "./devTimeAllocation";

export interface ReworkCostByWeek {
  week: string;
  reworkDays: number;
  reworkedIssues: number;
}

export interface ReworkCostBySprint {
  sprintId: number;
  sprintName: string;
  reworkDays: number;
  reworkedIssues: number;
}

export interface ReworkCostResult {
  count: number;
  reworkedCount: number;
  reworkRatio: number;
  totalReworkDays: number;
  avgReworkDaysPerReworkedTicket: number;
  reworkCostRatio: number;
  byWeek: ReworkCostByWeek[];
  bySprint: ReworkCostBySprint[];
}

type RoleKey = "dev" | "qa" | "po";

interface RoleBlock {
  role: RoleKey;
  startAt: string;
  endAt: string;
  isRework: boolean;
}

function getRole(status: string, roles: Record<RoleKey, Set<string>>): RoleKey | null {
  if (roles.dev.has(status)) {return "dev";}
  if (roles.qa.has(status)) {return "qa";}
  if (roles.po.has(status)) {return "po";}
  return null;
}

function extractReworkBlocks(
  transitions: TransitionRow[],
  done_at: string,
  roles: Record<RoleKey, Set<string>>,
): RoleBlock[] {
  const blocks: RoleBlock[] = [];
  const passCount: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
  let currentRole: RoleKey | null = null;
  let currentBlockStart: string | null = null;
  let currentIsRework = false;

  for (const t of transitions) {
    const role = getRole(t.to_status, roles);
    if (role !== currentRole) {
      if (currentRole !== null && currentBlockStart !== null) {
        blocks.push({ role: currentRole, startAt: currentBlockStart, endAt: t.transitioned_at, isRework: currentIsRework });
      }
      if (role !== null) {
        passCount[role]++;
        currentIsRework = passCount[role] > 1;
        currentRole = role;
        currentBlockStart = t.transitioned_at;
      } else {
        currentRole = null;
        currentBlockStart = null;
        currentIsRework = false;
      }
    }
  }
  if (currentRole !== null && currentBlockStart !== null) {
    blocks.push({ role: currentRole, startAt: currentBlockStart, endAt: done_at, isRework: currentIsRework });
  }
  return blocks;
}


export const reworkCostMetric: Metric<ReworkCostResult> = {
  name: "rework-cost",
  description:
    "Coût en jours-ouvrés des passes rework (2e passe ou + dans un même rôle) par semaine et par sprint. Quantifie l'impact économique du rework sur la vélocité.",

  compute(db: Database.Database, config: MetricConfig): ReworkCostResult {
    const allTransitions = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(allTransitions);

    const roles: Record<RoleKey, Set<string>> = {
      dev: new Set(config.devStatuses ?? []),
      qa: new Set(config.qaStatuses ?? []),
      po: new Set(config.poStatuses ?? []),
    };

    const sprintRows = db.prepare(
      "SELECT id, name, start_date, end_date FROM sprints WHERE start_date IS NOT NULL AND end_date IS NOT NULL",
    ).all() as { id: number; name: string; start_date: string; end_date: string }[];

    const byWeekMap = new Map<string, { reworkDays: number; issues: Set<string> }>();
    const bySprintMap = new Map<number, { sprintId: number; sprintName: string; reworkDays: number; reworkedIssues: Set<string> }>();

    let count = 0;
    let totalReworkDays = 0;
    let reworkedCycleTimeDays = 0;
    const reworkedKeys = new Set<string>();

    for (const [issueKey, transitions] of byIssue) {
      count++;
      const done_at = transitions[0].done_at;
      const started_at = transitions[0].started_at;

      const blocks = extractReworkBlocks(transitions, done_at, roles);
      const reworkBlocks = blocks.filter((b) => b.isRework);

      if (reworkBlocks.length === 0) {continue;}

      reworkedKeys.add(issueKey);
      reworkedCycleTimeDays += workingDaysBetween(started_at, done_at);

      for (const block of reworkBlocks) {
        const days = workingDaysBetween(block.startAt, block.endAt);
        if (days <= 0) {continue;}

        totalReworkDays += days;

        for (const [week, alloc] of distributeAcrossWeeks(block.startAt, block.endAt, days)) {
          const entry = byWeekMap.get(week) ?? { reworkDays: 0, issues: new Set<string>() };
          entry.reworkDays += alloc;
          entry.issues.add(issueKey);
          byWeekMap.set(week, entry);
        }

        const matchingSprint = sprintRows.find(
          (s) => block.endAt >= s.start_date && block.endAt <= s.end_date,
        );
        if (matchingSprint) {
          const entry = bySprintMap.get(matchingSprint.id) ?? {
            sprintId: matchingSprint.id,
            sprintName: matchingSprint.name,
            reworkDays: 0,
            reworkedIssues: new Set<string>(),
          };
          entry.reworkDays += days;
          entry.reworkedIssues.add(issueKey);
          bySprintMap.set(matchingSprint.id, entry);
        }
      }
    }

    const reworkedCount = reworkedKeys.size;

    const byWeek: ReworkCostByWeek[] = Array.from(byWeekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, { reworkDays, issues }]) => ({ week, reworkDays, reworkedIssues: issues.size }));

    const bySprint: ReworkCostBySprint[] = Array.from(bySprintMap.values())
      .sort((a, b) => a.sprintId - b.sprintId)
      .map(({ sprintId, sprintName, reworkDays, reworkedIssues }) => ({
        sprintId,
        sprintName,
        reworkDays,
        reworkedIssues: reworkedIssues.size,
      }));

    return {
      count,
      reworkedCount,
      reworkRatio: count > 0 ? reworkedCount / count : 0,
      totalReworkDays,
      avgReworkDaysPerReworkedTicket: reworkedCount > 0 ? totalReworkDays / reworkedCount : 0,
      reworkCostRatio: reworkedCycleTimeDays > 0 ? totalReworkDays / reworkedCycleTimeDays : 0,
      byWeek,
      bySprint,
    };
  },
};

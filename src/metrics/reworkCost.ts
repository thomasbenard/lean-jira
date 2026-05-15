import { type Metric } from "./types";
import type { MetricsContext } from "./context";
import type { TransitionRecord } from "../store/types";
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
  transitions: TransitionRecord[],
  doneAt: string,
  roles: Record<RoleKey, Set<string>>,
): RoleBlock[] {
  const blocks: RoleBlock[] = [];
  const passCount: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
  let currentRole: RoleKey | null = null;
  let currentBlockStart: string | null = null;
  let currentIsRework = false;

  for (const t of transitions) {
    const role = getRole(t.toStatus, roles);
    if (role !== currentRole) {
      if (currentRole !== null && currentBlockStart !== null) {
        blocks.push({ role: currentRole, startAt: currentBlockStart, endAt: t.transitionedAt, isRework: currentIsRework });
      }
      if (role !== null) {
        passCount[role]++;
        currentIsRework = passCount[role] > 1;
        currentRole = role;
        currentBlockStart = t.transitionedAt;
      } else {
        currentRole = null;
        currentBlockStart = null;
        currentIsRework = false;
      }
    }
  }
  if (currentRole !== null && currentBlockStart !== null) {
    blocks.push({ role: currentRole, startAt: currentBlockStart, endAt: doneAt, isRework: currentIsRework });
  }
  return blocks;
}


export const reworkCostMetric: Metric<ReworkCostResult> = {
  name: "rework-cost",
  description:
    "Coût en jours-ouvrés des passes rework (2e passe ou + dans un même rôle) par semaine et par sprint. Quantifie l'impact économique du rework sur la vélocité.",

  compute(ctx: MetricsContext): ReworkCostResult {
    const config = ctx.config;
    const roles: Record<RoleKey, Set<string>> = {
      dev: new Set(config.devStatuses ?? []),
      qa: new Set(config.qaStatuses ?? []),
      po: new Set(config.poStatuses ?? []),
    };

    const sprintRows = ctx.store.sprints.all().filter(
      (s): s is typeof s & { startDate: string; endDate: string } =>
        s.startDate !== null && s.endDate !== null,
    );

    const byWeekMap = new Map<string, { reworkDays: number; issues: Set<string> }>();
    const bySprintMap = new Map<number, { sprintId: number; sprintName: string; reworkDays: number; reworkedIssues: Set<string> }>();

    let totalReworkDays = 0;
    let reworkedCycleTimeDays = 0;
    const reworkedKeys = new Set<string>();

    for (const sample of ctx.cycleTimePopulation) {
      // pourquoi : SQL legacy filtrait tr.transitioned_at >= started_at AND <= done_at
      const allTrans = ctx.transitionsByIssue.get(sample.issueKey) ?? [];
      const trans = allTrans.filter(
        (t) => t.transitionedAt >= sample.startedAt && t.transitionedAt <= sample.doneAt,
      );

      const blocks = extractReworkBlocks(trans, sample.doneAt, roles);
      const reworkBlocks = blocks.filter((b) => b.isRework);
      if (reworkBlocks.length === 0) { continue; }

      reworkedKeys.add(sample.issueKey);
      reworkedCycleTimeDays += ctx.workingDaysBetween(sample.startedAt, sample.doneAt);

      for (const block of reworkBlocks) {
        const days = ctx.workingDaysBetween(block.startAt, block.endAt);
        if (days <= 0) { continue; }
        totalReworkDays += days;

        for (const [week, alloc] of distributeAcrossWeeks(block.startAt, block.endAt, days)) {
          const entry = byWeekMap.get(week) ?? { reworkDays: 0, issues: new Set<string>() };
          entry.reworkDays += alloc;
          entry.issues.add(sample.issueKey);
          byWeekMap.set(week, entry);
        }

        const matchingSprint = sprintRows.find(
          (s) => block.endAt >= s.startDate && block.endAt <= s.endDate,
        );
        if (matchingSprint) {
          const entry = bySprintMap.get(matchingSprint.id) ?? {
            sprintId: matchingSprint.id,
            sprintName: matchingSprint.name,
            reworkDays: 0,
            reworkedIssues: new Set<string>(),
          };
          entry.reworkDays += days;
          entry.reworkedIssues.add(sample.issueKey);
          bySprintMap.set(matchingSprint.id, entry);
        }
      }
    }

    const count = ctx.cycleTimePopulation.length;
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

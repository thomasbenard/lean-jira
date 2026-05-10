import type Database from "better-sqlite3";
import { upsertIssues, upsertSprints, replaceTransitions, upsertStatuses } from "../../src/db/store";
import type { StoredIssue, StoredSprint, StoredStatus, Transition } from "../../src/jira/types";
import type { MetricConfig } from "../../src/metrics/types";

let _seq = 0;
export function resetSeq(): void {
  _seq = 0;
}

export function makeIssue(overrides: Partial<StoredIssue> = {}): StoredIssue {
  _seq++;
  return {
    key: `PROJ-${_seq}`,
    summary: `Issue ${_seq}`,
    issueType: "Story",
    createdAt: "2025-01-01T00:00:00.000Z",
    resolvedAt: null,
    currentStatus: "To Do",
    assignee: null,
    priority: null,
    currentSprintId: null,
    originalEstimateSeconds: null,
    storyPoints: null,
    sizeLabel: null,
    ...overrides,
  };
}

export function makeTransitions(
  issueKey: string,
  steps: Array<{ to: string; at: string; from?: string | null }>
): Transition[] {
  return steps.map((s, i) => ({
    issueKey,
    fromStatus: s.from !== undefined ? s.from : i === 0 ? null : steps[i - 1].to,
    toStatus: s.to,
    transitionedAt: s.at,
  }));
}

export function seedIssueWithTransitions(
  db: Database.Database,
  issue: StoredIssue,
  steps: Array<{ to: string; at: string; from?: string | null }>
): void {
  upsertIssues(db, [issue]);
  replaceTransitions(db, issue.key, makeTransitions(issue.key, steps));
}

export function makeSprint(overrides: Partial<StoredSprint> = {}): StoredSprint {
  return {
    id: 1,
    name: "Sprint 1",
    state: "active",
    startDate: "2025-01-06T00:00:00.000Z",
    endDate: "2025-01-20T00:00:00.000Z",
    boardId: 1,
    ...overrides,
  };
}

export function seedSprint(db: Database.Database, sprint: StoredSprint): void {
  upsertSprints(db, [sprint]);
}

export function seedStatus(db: Database.Database, name: string, categoryKey: string): void {
  const status: StoredStatus = { name, categoryKey, categoryName: categoryKey };
  upsertStatuses(db, [status]);
}

export const TEST_CONFIG: MetricConfig = {
  todoStatuses: ["To Do"],
  devStartStatuses: ["In Progress"],
  inProgressStatuses: ["In Progress", "In Review"],
  doneStatuses: ["Done"],
  activeStatuses: ["In Progress"],
  queueStatuses: ["In Review"],
  bugIssueTypes: ["Bug"],
  excludeIssueTypes: [],
  excludeOutliers: false,
  estimation: { method: "time" },
};

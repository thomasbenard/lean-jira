import { vi } from "vitest";
import type { Store } from "../../../src/store/types";

export interface FakeStoreOverrides {
  appConfigGet?: (key: string) => string | null;
  syncLogLast?: () => { syncedAt: string; issuesCount: number; projectKey: string } | null;
}

export function makeFakeStore(overrides: FakeStoreOverrides = {}): Store {
  return {
    statuses: { all: vi.fn(), upsertMany: vi.fn() },
    sprints: { all: vi.fn(), byId: vi.fn(), upsertMany: vi.fn() },
    issues: { all: vi.fn(), byKey: vi.fn(), byKeys: vi.fn(), upsertMany: vi.fn() },
    transitions: { all: vi.fn(), byIssue: vi.fn(), replaceForIssue: vi.fn(), replaceForIssues: vi.fn() },
    issueFieldChanges: { byIssueAndField: vi.fn(), replaceForIssues: vi.fn() },
    issueSprints: { bySprint: vi.fn(), byIssue: vi.fn(), replaceForIssues: vi.fn() },
    snapshots: { all: vi.fn(), byDate: vi.fn(), replaceAll: vi.fn() },
    syncLog: {
      lastByProject: vi.fn(overrides.syncLogLast ?? (() => null)),
      append: vi.fn(),
    },
    appConfig: {
      get: vi.fn(overrides.appConfigGet ?? (() => "time")),
      set: vi.fn(),
    },
    transaction: <T>(fn: () => T) => fn(),
  } as unknown as Store;
}

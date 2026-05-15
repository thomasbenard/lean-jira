import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Store } from "../../src/store/types";

const { mockFetchAllStatuses, mockFetchAllSprints, mockFetchAllIssues } = vi.hoisted(() => ({
  mockFetchAllStatuses: vi.fn().mockResolvedValue([]),
  mockFetchAllSprints: vi.fn().mockResolvedValue([]),
  mockFetchAllIssues: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/jira/client", () => ({
  JiraClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.fetchAllStatuses = mockFetchAllStatuses;
    this.fetchAllSprints = mockFetchAllSprints;
    this.fetchAllIssues = mockFetchAllIssues;
  }),
}));

import { sync } from "../../src/sync";

interface FakeStoreOverrides {
  appConfigGet?: (key: string) => string | null;
  syncLogLast?: () => { syncedAt: string; issuesCount: number; projectKey: string } | null;
}

function makeFakeStore(overrides: FakeStoreOverrides = {}): Store {
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

const baseConfig = {
  jira: { baseUrl: "https://example.atlassian.net", email: "t@t.com", apiToken: "tok", projectKey: "KECK", boardId: 42 },
  db: { path: ":memory:" },
};

function makeJiraIssue(key: string, histories: { created: string; items: { field: string; fromString: string | null; toString: string | null }[] }[]) {
  return {
    id: key,
    key,
    fields: {
      summary: `Issue ${key}`,
      issuetype: { name: "Story" },
      status: { name: "To Do" },
      created: "2026-01-01T00:00:00.000Z",
      resolutiondate: null,
      assignee: null,
      priority: null,
    },
    changelog: { histories },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchAllStatuses.mockResolvedValue([]);
  mockFetchAllSprints.mockResolvedValue([]);
  mockFetchAllIssues.mockResolvedValue([]);
});

describe("extractFieldChanges — champs surveillés", () => {
  it("extrait un changement de description", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "description", fromString: null, toString: "Contenu" }] },
      ]),
    ]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    expect(store.issueFieldChanges.replaceForIssues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          key: "KECK-1",
          rows: expect.arrayContaining([
            expect.objectContaining({ fieldName: "description", fromValue: null, toValue: "Contenu" }),
          ]),
        }),
      ]),
    );
  });

  it("extrait un changement de summary", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "summary", fromString: "Avant", toString: "Après" }] },
      ]),
    ]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    const call = vi.mocked(store.issueFieldChanges.replaceForIssues).mock.calls[0][0];
    expect(call[0].rows[0]).toMatchObject({ fieldName: "summary", fromValue: "Avant", toValue: "Après" });
  });

  it("extrait un changement de Story Points", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "Story Points", fromString: "3", toString: "5" }] },
      ]),
    ]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    const call = vi.mocked(store.issueFieldChanges.replaceForIssues).mock.calls[0][0];
    expect(call[0].rows[0]).toMatchObject({ fieldName: "Story Points", fromValue: "3", toValue: "5" });
  });

  it("extrait un changement de Sprint", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "Sprint", fromString: null, toString: "Sprint 42" }] },
      ]),
    ]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    const call = vi.mocked(store.issueFieldChanges.replaceForIssues).mock.calls[0][0];
    expect(call[0].rows[0]).toMatchObject({ fieldName: "Sprint", fromValue: null, toValue: "Sprint 42" });
  });

  it("ignore les champs non surveillés (status, assignee)", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        {
          created: "2026-02-01T10:00:00.000Z",
          items: [
            { field: "status", fromString: "To Do", toString: "In Progress" },
            { field: "assignee", fromString: null, toString: "Alice" },
            { field: "summary", fromString: "Titre", toString: "Titre v2" },
          ],
        },
      ]),
    ]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    const call = vi.mocked(store.issueFieldChanges.replaceForIssues).mock.calls[0][0];
    expect(call[0].rows).toHaveLength(1);
    expect(call[0].rows[0].fieldName).toBe("summary");
  });

  it("retourne liste vide si changelog absent", async () => {
    const issue = makeJiraIssue("KECK-1", []);
    (issue as Record<string, unknown>).changelog = undefined;
    mockFetchAllIssues.mockResolvedValue([issue]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    const call = vi.mocked(store.issueFieldChanges.replaceForIssues).mock.calls[0][0];
    expect(call[0].rows).toHaveLength(0);
  });
});

describe("sync — appel issueFieldChanges.replaceForIssues", () => {
  it("appelle issueFieldChanges.replaceForIssues pour chaque issue", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", []),
      makeJiraIssue("KECK-2", []),
    ]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    expect(store.issueFieldChanges.replaceForIssues).toHaveBeenCalledOnce();
    const call = vi.mocked(store.issueFieldChanges.replaceForIssues).mock.calls[0][0];
    expect(call).toHaveLength(2);
    expect(call.map((c: { key: string }) => c.key)).toEqual(["KECK-1", "KECK-2"]);
  });

  it("appelle issueFieldChanges.replaceForIssues avec liste vide si aucune issue", async () => {
    const store = makeFakeStore();
    await sync(store, baseConfig);
    expect(store.issueFieldChanges.replaceForIssues).toHaveBeenCalledWith([]);
  });
});

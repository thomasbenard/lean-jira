import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchAllStatuses, mockFetchAllSprints, mockFetchAllIssues, mockReplaceAllFieldChanges } = vi.hoisted(() => ({
  mockFetchAllStatuses: vi.fn().mockResolvedValue([]),
  mockFetchAllSprints: vi.fn().mockResolvedValue([]),
  mockFetchAllIssues: vi.fn().mockResolvedValue([]),
  mockReplaceAllFieldChanges: vi.fn(),
}));

vi.mock("../../src/jira/client", () => ({
  JiraClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.fetchAllStatuses = mockFetchAllStatuses;
    this.fetchAllSprints = mockFetchAllSprints;
    this.fetchAllIssues = mockFetchAllIssues;
  }),
}));

vi.mock("../../src/db/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/store")>();
  return {
    ...actual,
    openDb: vi.fn(),
    upsertIssues: vi.fn(),
    upsertSprints: vi.fn(),
    upsertStatuses: vi.fn(),
    replaceAllTransitions: vi.fn(),
    replaceAllFieldChanges: mockReplaceAllFieldChanges,
    replaceAllIssueSprints: vi.fn(),
    logSync: vi.fn(),
    getLastSyncDate: vi.fn(),
    getStoredEstimationMethod: vi.fn().mockReturnValue("time"),
    persistEstimationMethod: vi.fn(),
  };
});

import * as store from "../../src/db/store";
import { sync } from "../../src/sync";

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
  vi.mocked(store.openDb).mockReturnValue({} as ReturnType<typeof store.openDb>);
  vi.mocked(store.getLastSyncDate).mockReturnValue(null);
});

describe("extractFieldChanges — champs surveillés", () => {
  it("extrait un changement de description", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "description", fromString: null, toString: "Contenu" }] },
      ]),
    ]);
    await sync(baseConfig);
    expect(mockReplaceAllFieldChanges).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          key: "KECK-1",
          changes: expect.arrayContaining([
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
    await sync(baseConfig);
    const call = mockReplaceAllFieldChanges.mock.calls[0][1];
    expect(call[0].changes[0]).toMatchObject({ fieldName: "summary", fromValue: "Avant", toValue: "Après" });
  });

  it("extrait un changement de Story Points", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "Story Points", fromString: "3", toString: "5" }] },
      ]),
    ]);
    await sync(baseConfig);
    const call = mockReplaceAllFieldChanges.mock.calls[0][1];
    expect(call[0].changes[0]).toMatchObject({ fieldName: "Story Points", fromValue: "3", toValue: "5" });
  });

  it("extrait un changement de Sprint", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", [
        { created: "2026-02-01T10:00:00.000Z", items: [{ field: "Sprint", fromString: null, toString: "Sprint 42" }] },
      ]),
    ]);
    await sync(baseConfig);
    const call = mockReplaceAllFieldChanges.mock.calls[0][1];
    expect(call[0].changes[0]).toMatchObject({ fieldName: "Sprint", fromValue: null, toValue: "Sprint 42" });
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
    await sync(baseConfig);
    const call = mockReplaceAllFieldChanges.mock.calls[0][1];
    expect(call[0].changes).toHaveLength(1);
    expect(call[0].changes[0].fieldName).toBe("summary");
  });

  it("retourne liste vide si changelog absent", async () => {
    const issue = makeJiraIssue("KECK-1", []);
    (issue as Record<string, unknown>).changelog = undefined;
    mockFetchAllIssues.mockResolvedValue([issue]);
    await sync(baseConfig);
    const call = mockReplaceAllFieldChanges.mock.calls[0][1];
    expect(call[0].changes).toHaveLength(0);
  });
});

describe("sync — appel replaceAllFieldChanges", () => {
  it("appelle replaceAllFieldChanges pour chaque issue", async () => {
    mockFetchAllIssues.mockResolvedValue([
      makeJiraIssue("KECK-1", []),
      makeJiraIssue("KECK-2", []),
    ]);
    await sync(baseConfig);
    expect(mockReplaceAllFieldChanges).toHaveBeenCalledOnce();
    const call = mockReplaceAllFieldChanges.mock.calls[0][1];
    expect(call).toHaveLength(2);
    expect(call.map((c: { key: string }) => c.key)).toEqual(["KECK-1", "KECK-2"]);
  });

  it("appelle replaceAllFieldChanges avec liste vide si aucune issue", async () => {
    await sync(baseConfig);
    expect(mockReplaceAllFieldChanges).toHaveBeenCalledWith(expect.anything(), []);
  });
});

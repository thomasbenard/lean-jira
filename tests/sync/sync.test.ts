import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock JiraClient
const mockFetchAllStatuses = vi.fn().mockResolvedValue([]);
const mockFetchAllSprints = vi.fn().mockResolvedValue([]);
const mockFetchAllIssues = vi.fn().mockResolvedValue([]);

vi.mock("../../src/jira/client", () => ({
  JiraClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.fetchAllStatuses = mockFetchAllStatuses;
    this.fetchAllSprints = mockFetchAllSprints;
    this.fetchAllIssues = mockFetchAllIssues;
  }),
}));

// Mock store functions
vi.mock("../../src/db/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/store")>();
  return {
    ...actual,
    openDb: vi.fn(),
    upsertIssues: vi.fn(),
    upsertSprints: vi.fn(),
    upsertStatuses: vi.fn(),
    replaceAllTransitions: vi.fn(),
    replaceAllFieldChanges: vi.fn(),
    replaceAllIssueSprints: vi.fn(),
    logSync: vi.fn(),
    getLastSyncDate: vi.fn(),
    getStoredEstimationMethod: vi.fn().mockReturnValue("time"),
    persistEstimationMethod: vi.fn(),
  };
});

import { JiraClient } from "../../src/jira/client";
import * as store from "../../src/db/store";
import { sync } from "../../src/sync";

const baseConfig = {
  jira: {
    baseUrl: "https://example.atlassian.net",
    email: "test@example.com",
    apiToken: "token",
    projectKey: "KECK",
    boardId: 42,
  },
  db: { path: ":memory:" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchAllStatuses.mockResolvedValue([]);
  mockFetchAllSprints.mockResolvedValue([]);
  mockFetchAllIssues.mockResolvedValue([]);
  vi.mocked(store.openDb).mockReturnValue({} as ReturnType<typeof store.openDb>);
  vi.mocked(store.getLastSyncDate).mockReturnValue(null);
});

describe("sync — détection premier sync vs incrémental", () => {
  it("appelle fetchAllIssues sans updatedSince si sync_log est vide", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue(null);
    await sync(baseConfig);
    expect(mockFetchAllIssues).toHaveBeenCalledWith(expect.any(Function), undefined);
  });

  it("appelle fetchAllIssues avec updatedSince si sync_log a une entrée", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-01T07:00:00.000Z");
    await sync(baseConfig);
    expect(mockFetchAllIssues).toHaveBeenCalledWith(expect.any(Function), "2026-04-01T07:00:00.000Z");
  });

  it("affiche 'Premier sync — récupération complète' si pas de sync précédent", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue(null);
    const consoleSpy = vi.spyOn(console, "log");
    await sync(baseConfig);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("First sync — full fetch"));
  });

  it("affiche 'Sync incrémental depuis <date>' si sync précédent existe", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-01T07:00:00.000Z");
    const consoleSpy = vi.spyOn(console, "log");
    await sync(baseConfig);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Incremental sync from 2026-04-01T07:00:00.000Z"));
  });
});

describe("sync — liste vide si aucune issue modifiée", () => {
  it("se termine sans erreur si aucune issue retournée", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-20T10:00:00.000Z");
    await expect(sync(baseConfig)).resolves.toBeUndefined();
  });

  it("appelle upsertIssues avec liste vide", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-20T10:00:00.000Z");
    await sync(baseConfig);
    expect(store.upsertIssues).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("appelle replaceAllTransitions avec liste vide", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-20T10:00:00.000Z");
    await sync(baseConfig);
    expect(store.replaceAllTransitions).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("enregistre logSync avec 0 issues", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-20T10:00:00.000Z");
    await sync(baseConfig);
    expect(store.logSync).toHaveBeenCalledWith(expect.anything(), "KECK", 0);
  });

  it("appelle replaceAllIssueSprints avec liste vide si aucune issue", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-20T10:00:00.000Z");
    await sync(baseConfig);
    expect(store.replaceAllIssueSprints).toHaveBeenCalledWith(expect.anything(), []);
  });
});

describe("sync — extraction issue_sprints depuis customfield_10020", () => {
  it("stocke les sprint ids de customfield_10020 pour chaque issue", async () => {
    mockFetchAllIssues.mockResolvedValue([
      {
        key: "PROJ-1",
        fields: {
          summary: "US test",
          issuetype: { name: "Story" },
          status: { name: "Done" },
          created: "2025-01-01T00:00:00.000Z",
          resolutiondate: null,
          assignee: null,
          priority: null,
          timeoriginalestimate: null,
          customfield_10020: [
            { id: 10, name: "Sprint A", state: "closed", startDate: "2025-01-01T00:00:00.000Z", endDate: "2025-01-14T00:00:00.000Z" },
            { id: 11, name: "Sprint B", state: "active", startDate: "2025-01-15T00:00:00.000Z", endDate: "2025-01-28T00:00:00.000Z" },
          ],
        },
        changelog: { histories: [] },
      },
    ]);
    await sync(baseConfig);
    expect(store.replaceAllIssueSprints).toHaveBeenCalledWith(
      expect.anything(),
      [{ key: "PROJ-1", sprintIds: [10, 11] }],
    );
  });

  it("stocke liste vide si customfield_10020 est null", async () => {
    mockFetchAllIssues.mockResolvedValue([
      {
        key: "PROJ-1",
        fields: {
          summary: "US test",
          issuetype: { name: "Story" },
          status: { name: "Done" },
          created: "2025-01-01T00:00:00.000Z",
          resolutiondate: null,
          assignee: null,
          priority: null,
          timeoriginalestimate: null,
          customfield_10020: null,
        },
        changelog: { histories: [] },
      },
    ]);
    await sync(baseConfig);
    expect(store.replaceAllIssueSprints).toHaveBeenCalledWith(
      expect.anything(),
      [{ key: "PROJ-1", sprintIds: [] }],
    );
  });
});

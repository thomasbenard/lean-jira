import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock JiraClient
const mockFetchAllStatuses = vi.fn().mockResolvedValue([]);
const mockFetchAllSprints = vi.fn().mockResolvedValue([]);
const mockFetchAllIssues = vi.fn().mockResolvedValue([]);

vi.mock("../../src/jira/client", () => ({
  JiraClient: vi.fn().mockImplementation(function () {
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
    logSync: vi.fn(),
    getLastSyncDate: vi.fn(),
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
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Premier sync — récupération complète"));
  });

  it("affiche 'Sync incrémental depuis <date>' si sync précédent existe", async () => {
    vi.mocked(store.getLastSyncDate).mockReturnValue("2026-04-01T07:00:00.000Z");
    const consoleSpy = vi.spyOn(console, "log");
    await sync(baseConfig);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Sync incrémental depuis 2026-04-01T07:00:00.000Z"));
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
});

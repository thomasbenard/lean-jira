import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { sync } from "../../src/sync";
import { makeFakeStore } from "./helpers/fakeStore";

const baseIssue = {
  key: "PROJ-1",
  fields: {
    summary: "Issue test",
    issuetype: { name: "Story" },
    status: { name: "Done" },
    created: "2025-01-01T00:00:00.000Z",
    resolutiondate: null,
    assignee: null,
    priority: null,
    timeoriginalestimate: null,
    customfield_10020: null,
    customfield_10016: null,
  },
  changelog: { histories: [] },
};

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
});

describe("extractEstimation — méthode time", () => {
  it("stocke story_points et size_label à null pour méthode time", async () => {
    mockFetchAllIssues.mockResolvedValue([{ ...baseIssue }]);
    const store = makeFakeStore();
    await sync(store, baseConfig);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: null, sizeLabel: null })]),
    );
  });
});

describe("extractEstimation — méthode story-points", () => {
  const config = { ...baseConfig, estimation: { method: "story-points" as const } };

  it("stocke story_points depuis customfield_10016", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10016: 8 },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: 8 })]),
    );
  });

  it("stocke null si customfield_10016 est 0", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10016: 0 },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: null })]),
    );
  });

  it("stocke null si customfield_10016 est négatif", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10016: -1 },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: null })]),
    );
  });

  it("stocke null si customfield_10016 est null", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10016: null },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: null })]),
    );
  });

  it("size_label reste null pour story-points", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10016: 5 },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sizeLabel: null })]),
    );
  });
});

describe("extractEstimation — méthode numeric", () => {
  const config = {
    ...baseConfig,
    estimation: { method: "numeric" as const, jiraField: "customfield_10099" },
  };

  it("stocke story_points depuis jiraField custom", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10099: 13 },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: 13 })]),
    );
  });
});

describe("extractEstimation — méthode t-shirt", () => {
  const config = {
    ...baseConfig,
    estimation: { method: "t-shirt" as const, jiraField: "customfield_10200" },
  };

  it("stocke size_label depuis string directe", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10200: "M" },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sizeLabel: "M" })]),
    );
  });

  it("stocke size_label depuis objet { value: 'M' } (Jira Cloud)", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10200: { value: "M" } },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sizeLabel: "M" })]),
    );
  });

  it("normalise en majuscules", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10200: "xl" },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sizeLabel: "XL" })]),
    );
  });

  it("stocke null et émet warning si label inconnu", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10200: "Extra Small" },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sizeLabel: null })]),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("size_label not recognized"));
  });

  it("story_points reste null pour t-shirt", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10200: "S" },
    }]);
    const store = makeFakeStore();
    await sync(store, config);
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: null })]),
    );
  });
});

describe("extractEstimation — méthode none", () => {
  it("stocke story_points et size_label à null", async () => {
    mockFetchAllIssues.mockResolvedValue([{
      ...baseIssue,
      fields: { ...baseIssue.fields, customfield_10016: 8 },
    }]);
    const store = makeFakeStore();
    await sync(store, { ...baseConfig, estimation: { method: "none" as const } });
    expect(store.issues.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storyPoints: null, sizeLabel: null })]),
    );
  });
});

describe("détection changement de méthode", () => {
  it("force full resync si méthode change (storedMethod ≠ currentMethod)", async () => {
    const store = makeFakeStore({
      syncLogLast: () => ({ syncedAt: "2026-04-01T07:00:00.000Z", issuesCount: 0, projectKey: "KECK" }),
      appConfigGet: () => "time",
    });
    const warnSpy = vi.spyOn(console, "warn");
    await sync(store, { ...baseConfig, estimation: { method: "story-points" as const } });
    expect(mockFetchAllIssues).toHaveBeenCalledWith(expect.any(Function), undefined);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Estimation method changed"));
  });

  it("sync incrémental normal si méthode inchangée", async () => {
    const store = makeFakeStore({
      syncLogLast: () => ({ syncedAt: "2026-04-01T07:00:00.000Z", issuesCount: 0, projectKey: "KECK" }),
      appConfigGet: () => "story-points",
    });
    await sync(store, { ...baseConfig, estimation: { method: "story-points" as const } });
    expect(mockFetchAllIssues).toHaveBeenCalledWith(expect.any(Function), "2026-04-01T07:00:00.000Z");
  });

  it("persiste la méthode courante après sync", async () => {
    const store = makeFakeStore();
    await sync(store, { ...baseConfig, estimation: { method: "story-points" as const } });
    expect(store.appConfig.set).toHaveBeenCalledWith("estimation_method", "story-points");
  });

  it("persiste time si estimation absente du config", async () => {
    const store = makeFakeStore();
    await sync(store, baseConfig);
    expect(store.appConfig.set).toHaveBeenCalledWith("estimation_method", "time");
  });
});

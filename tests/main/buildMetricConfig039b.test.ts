import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMetricConfig } from "../../src/main";
import type Database from "better-sqlite3";

vi.mock("../../src/db/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/store")>();
  return {
    ...actual,
    getDoneStatusNames: vi.fn().mockReturnValue([]),
  };
});

function makeDb(): Database.Database {
  return {} as Database.Database;
}

const BASE_BOARD = {
  columns: [
    { type: "todo" as const, statuses: ["To Do"] },
    { type: "active" as const, devStart: true, statuses: ["In Progress"] },
    { type: "done" as const, statuses: ["Done"] },
  ],
  legacyDoneStatuses: [] as string[],
};

const BASE_APP = {
  jira: { baseUrl: "https://x.atlassian.net", projectKey: "X", boardId: 1 },
  db: { path: ":memory:" },
  board: BASE_BOARD,
};

describe("buildMetricConfig — propagation estimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("défaut { method: 'time' } si metrics.estimation absent", () => {
    const config = buildMetricConfig(makeDb(), BASE_APP);
    expect(config.estimation).toEqual({ method: "time" });
  });

  it("propage metrics.estimation story-points", () => {
    const app = {
      ...BASE_APP,
      metrics: { estimation: { method: "story-points" as const } },
    };
    const config = buildMetricConfig(makeDb(), app);
    expect(config.estimation).toEqual({ method: "story-points" });
  });

  it("propage metrics.estimation t-shirt avec jiraField", () => {
    const app = {
      ...BASE_APP,
      metrics: {
        estimation: { method: "t-shirt" as const, jiraField: "customfield_10200" },
      },
    };
    const config = buildMetricConfig(makeDb(), app);
    expect(config.estimation).toEqual({ method: "t-shirt", jiraField: "customfield_10200" });
  });

  it("propage metrics.estimation numeric avec bucketThresholds", () => {
    const app = {
      ...BASE_APP,
      metrics: {
        estimation: {
          method: "numeric" as const,
          jiraField: "customfield_99",
          bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 },
        },
      },
    };
    const config = buildMetricConfig(makeDb(), app);
    expect(config.estimation.method).toBe("numeric");
    expect(config.estimation.bucketThresholds).toEqual({ xs: 2, s: 5, m: 10, l: 20 });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { buildMetricConfig } from "../../src/main";
import { SqliteStore } from "../../src/store/sqlite";
import { createTestDb } from "../helpers/db";

let store: SqliteStore;

beforeEach(() => {
  store = new SqliteStore(createTestDb());
});

const BASE_BOARD = {
  columns: [
    { name: "Todo", type: "todo" as const, statuses: ["To Do"] },
    { name: "In Progress", type: "active" as const, devStart: true, statuses: ["In Progress"] },
    { name: "Done", type: "done" as const, statuses: ["Done"] },
  ],
  legacyDoneStatuses: [] as string[],
};

const BASE_APP = {
  jira: { baseUrl: "https://x.atlassian.net", projectKey: "X", boardId: 1 },
  db: { path: ":memory:" },
  board: BASE_BOARD,
};

describe("buildMetricConfig — propagation estimation", () => {
  it("défaut { method: 'time' } si metrics.estimation absent", () => {
    const config = buildMetricConfig(store, BASE_APP);
    expect(config.estimation).toEqual({ method: "time" });
  });

  it("propage metrics.estimation story-points", () => {
    const app = {
      ...BASE_APP,
      metrics: { estimation: { method: "story-points" as const } },
    };
    const config = buildMetricConfig(store, app);
    expect(config.estimation).toEqual({ method: "story-points" });
  });

  it("propage metrics.estimation t-shirt avec jiraField", () => {
    const app = {
      ...BASE_APP,
      metrics: {
        estimation: { method: "t-shirt" as const, jiraField: "customfield_10200" },
      },
    };
    const config = buildMetricConfig(store, app);
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
    const config = buildMetricConfig(store, app);
    expect(config.estimation.method).toBe("numeric");
    expect(config.estimation.bucketThresholds).toEqual({ xs: 2, s: 5, m: 10, l: 20 });
  });
});

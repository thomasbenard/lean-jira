import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { FakeJiraClient } from "../../src/jira/fakeClient";

const FIXTURES_DIR = path.join(__dirname, "../../src/jira/fixtures");

describe("FakeJiraClient", () => {
  let client: FakeJiraClient;

  beforeEach(() => {
    client = new FakeJiraClient(FIXTURES_DIR);
  });

  it("fetchAllStatuses retourne les statuts des fixtures", async () => {
    const statuses = await client.fetchAllStatuses();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0]).toHaveProperty("name");
    expect(statuses[0]).toHaveProperty("statusCategory");
  });

  it("fetchAllSprints retourne les sprints des fixtures", async () => {
    const sprints = await client.fetchAllSprints();
    expect(sprints.length).toBeGreaterThan(0);
    expect(sprints.some((s) => s.state === "active")).toBe(true);
  });

  it("fetchAllIssues retourne toutes les issues sans filtre", async () => {
    const issues = await client.fetchAllIssues();
    expect(issues.length).toBeGreaterThan(30);
  });

  it("fetchAllIssues filtre par updatedSince", async () => {
    const all = await client.fetchAllIssues();
    const filtered = await client.fetchAllIssues(undefined, "2025-12-01T00:00:00.000Z");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(all.length);
  });

  it("fetchAllIssues appelle onProgress", async () => {
    let called = false;
    await client.fetchAllIssues((fetched, total) => {
      called = true;
      expect(fetched).toBe(total);
    });
    expect(called).toBe(true);
  });

  it("fetchBoardConfiguration retourne une config board", async () => {
    const cfg = await client.fetchBoardConfiguration();
    expect(cfg).toHaveProperty("columnConfig");
    expect(cfg.columnConfig.columns.length).toBeGreaterThan(0);
  });
});

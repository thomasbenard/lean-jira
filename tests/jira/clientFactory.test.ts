import { describe, it, expect } from "vitest";
import { createJiraClient } from "../../src/jira/clientFactory";
import { JiraClient } from "../../src/jira/client";
import { FakeJiraClient } from "../../src/jira/fakeClient";
import path from "path";

const FIXTURES_DIR = path.join(__dirname, "../../src/jira/fixtures");

describe("createJiraClient", () => {
  it("retourne FakeJiraClient quand mode=fake", () => {
    const client = createJiraClient({
      mode: "fake",
      fixturesPath: FIXTURES_DIR,
      baseUrl: "fake://local",
      email: "fake@example.com",
      apiToken: "fake",
      projectKey: "DEMO",
      boardId: 1,
    });
    expect(client).toBeInstanceOf(FakeJiraClient);
  });

  it("retourne JiraClient quand mode=real", () => {
    const client = createJiraClient({
      mode: "real",
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      projectKey: "PROJ",
      boardId: 1,
    });
    expect(client).toBeInstanceOf(JiraClient);
  });

  it("retourne JiraClient quand mode est absent", () => {
    const client = createJiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      projectKey: "PROJ",
      boardId: 1,
    });
    expect(client).toBeInstanceOf(JiraClient);
  });
});

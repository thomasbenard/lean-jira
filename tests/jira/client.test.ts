import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");

const mockGet = vi.fn();
const mockCreate = vi.spyOn(axios, "create").mockReturnValue({
  get: mockGet,
} as unknown as ReturnType<typeof axios.create>);

import { JiraClient } from "../../src/jira/client";

const baseConfig = {
  baseUrl: "https://example.atlassian.net",
  email: "test@example.com",
  apiToken: "token",
  projectKey: "PROJ",
  boardId: 42,
};

beforeEach(() => {
  mockGet.mockReset();
  mockCreate.mockClear();
});

describe("JiraClient — authentification", () => {
  it("mode Basic : axios.create reçoit auth username/password", () => {
    new JiraClient(baseConfig);
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs?.auth).toEqual({ username: "test@example.com", password: "token" });
    expect((createArgs?.headers as Record<string, string>)?.["Authorization"]).toBeUndefined();
  });

  it("mode PAT : axios.create reçoit Authorization Bearer, pas de auth", () => {
    new JiraClient({ ...baseConfig, personalAccessToken: "mon-pat-secret", email: undefined, apiToken: undefined });
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs?.auth).toBeUndefined();
    expect((createArgs?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer mon-pat-secret");
  });

  it("PAT vide (\"\") → mode Basic utilisé (auth présent, pas de Bearer)", () => {
    new JiraClient({ ...baseConfig, personalAccessToken: "" });
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs?.auth).toEqual({ username: "test@example.com", password: "token" });
    expect((createArgs?.headers as Record<string, string>)?.["Authorization"]).toBeUndefined();
  });

  it("PAT + email/apiToken présents → PAT prioritaire", () => {
    new JiraClient({ ...baseConfig, personalAccessToken: "mon-pat" });
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs?.auth).toBeUndefined();
    expect((createArgs?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer mon-pat");
  });
});

describe("fetchAllIssues — paramètre updatedSince", () => {
  it("n'inclut pas de paramètre jql si updatedSince est absent", async () => {
    mockGet.mockResolvedValueOnce({ data: { issues: [], total: 0 } });
    const client = new JiraClient(baseConfig);
    await client.fetchAllIssues();
    const callParams = mockGet.mock.calls[0][1].params;
    expect(callParams.jql).toBeUndefined();
  });

  it("inclut jql avec updated >= si updatedSince est fourni", async () => {
    mockGet.mockResolvedValueOnce({ data: { issues: [], total: 0 } });
    const client = new JiraClient(baseConfig);
    await client.fetchAllIssues(undefined, "2026-04-01T07:30:45.000Z");
    const callParams = mockGet.mock.calls[0][1].params;
    expect(callParams.jql).toBe(`updated >= "2026-04-01 07:30"`);
  });

  it("convertit ISO vers format JQL YYYY-MM-DD HH:MM (sans secondes ni T)", async () => {
    mockGet.mockResolvedValueOnce({ data: { issues: [], total: 0 } });
    const client = new JiraClient(baseConfig);
    await client.fetchAllIssues(undefined, "2026-12-31T23:59:59.000Z");
    const callParams = mockGet.mock.calls[0][1].params;
    expect(callParams.jql).toBe(`updated >= "2026-12-31 23:59"`);
  });

  it("n'inclut pas de jql si updatedSince est undefined explicitement", async () => {
    mockGet.mockResolvedValueOnce({ data: { issues: [], total: 0 } });
    const client = new JiraClient(baseConfig);
    await client.fetchAllIssues(undefined, undefined);
    const callParams = mockGet.mock.calls[0][1].params;
    expect(callParams.jql).toBeUndefined();
  });

  it("inclut jql sur chaque page lors d'une pagination multi-pages", async () => {
    const page1Issues = Array.from({ length: 100 }, (_, i) => ({ key: `PROJ-${i + 1}` }));
    mockGet
      .mockResolvedValueOnce({ data: { issues: page1Issues, total: 120 } })
      .mockResolvedValueOnce({ data: { issues: [{ key: "PROJ-101" }, { key: "PROJ-102" }], total: 120 } });
    const client = new JiraClient(baseConfig);
    await client.fetchAllIssues(undefined, "2026-04-01T07:00:00.000Z");
    expect(mockGet).toHaveBeenCalledTimes(2);
    const page2Params = mockGet.mock.calls[1][1].params;
    expect(page2Params.jql).toBe(`updated >= "2026-04-01 07:00"`);
  });
});

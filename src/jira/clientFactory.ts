import { JiraClient } from "./client";
import { FakeJiraClient } from "./fakeClient";
import type { JiraIssue, JiraSprint, JiraStatus, JiraBoardConfig, JiraConfig } from "./types";

export type { JiraConfig };

export interface JiraClientLike {
  fetchAllIssues(
    onProgress?: (fetched: number, total: number) => void,
    updatedSince?: string,
  ): Promise<JiraIssue[]>;
  fetchAllStatuses(): Promise<JiraStatus[]>;
  fetchBoardConfiguration(): Promise<JiraBoardConfig>;
  fetchAllSprints(): Promise<JiraSprint[]>;
}

export function createJiraClient(jira: JiraConfig): JiraClientLike {
  if (jira.mode === "fake") {
    return new FakeJiraClient(jira.fixturesPath);
  }
  return new JiraClient(jira);
}

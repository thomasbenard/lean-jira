import fs from "fs";
import path from "path";
import type { JiraIssue, JiraSprint, JiraStatus, JiraBoardConfig } from "./types";
import type { JiraClientLike } from "./clientFactory";

export class FakeJiraClient implements JiraClientLike {
  private fixturesDir: string;

  constructor(fixturesPath?: string) {
    this.fixturesDir = fixturesPath ? path.resolve(fixturesPath) : path.join(__dirname, "fixtures");
  }

  private load(filename: string): unknown {
    const content = fs.readFileSync(path.join(this.fixturesDir, filename), "utf-8");
    return JSON.parse(content);
  }

  fetchAllStatuses(): Promise<JiraStatus[]> {
    return Promise.resolve(this.load("statuses.json") as JiraStatus[]);
  }

  fetchAllSprints(): Promise<JiraSprint[]> {
    return Promise.resolve(this.load("sprints.json") as JiraSprint[]);
  }

  fetchBoardConfiguration(): Promise<JiraBoardConfig> {
    return Promise.resolve(this.load("boardConfig.json") as JiraBoardConfig);
  }

  fetchAllIssues(
    onProgress?: (fetched: number, total: number) => void,
    updatedSince?: string,
  ): Promise<JiraIssue[]> {
    const issues = this.load("issues.json") as (JiraIssue & { fields: { updated?: string } })[];
    const filtered = updatedSince
      ? issues.filter((i) => (i.fields.updated ?? i.fields.created) >= updatedSince)
      : issues;
    onProgress?.(filtered.length, filtered.length);
    return Promise.resolve(filtered);
  }
}

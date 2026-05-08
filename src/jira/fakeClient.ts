import fs from "fs";
import path from "path";
import type { JiraIssue, JiraSprint, JiraStatus, JiraBoardConfig } from "./types";
import type { JiraClientLike } from "./clientFactory";

export class FakeJiraClient implements JiraClientLike {
  private fixturesDir: string;

  constructor(fixturesPath?: string) {
    this.fixturesDir = fixturesPath ? path.resolve(fixturesPath) : path.join(__dirname, "fixtures");
  }

  private load<T>(filename: string): T {
    const content = fs.readFileSync(path.join(this.fixturesDir, filename), "utf-8");
    return JSON.parse(content) as T;
  }

  async fetchAllStatuses(): Promise<JiraStatus[]> {
    return this.load<JiraStatus[]>("statuses.json");
  }

  async fetchAllSprints(): Promise<JiraSprint[]> {
    return this.load<JiraSprint[]>("sprints.json");
  }

  async fetchBoardConfiguration(): Promise<JiraBoardConfig> {
    return this.load<JiraBoardConfig>("boardConfig.json");
  }

  async fetchAllIssues(
    onProgress?: (fetched: number, total: number) => void,
    updatedSince?: string,
  ): Promise<JiraIssue[]> {
    const issues = this.load<(JiraIssue & { fields: { updated?: string } })[]>("issues.json");
    const filtered = updatedSince
      ? issues.filter((i) => (i.fields.updated ?? i.fields.created) >= updatedSince)
      : issues;
    onProgress?.(filtered.length, filtered.length);
    return filtered;
  }
}

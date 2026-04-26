import axios, { AxiosInstance } from "axios";
import { JiraIssue } from "./types";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export class JiraClient {
  private http: AxiosInstance;
  private projectKey: string;

  constructor(config: JiraConfig) {
    this.projectKey = config.projectKey;
    this.http = axios.create({
      baseURL: `${config.baseUrl}/rest/api/2`,
      auth: { username: config.email, password: config.apiToken },
      headers: { "Content-Type": "application/json" },
    });
  }

  async fetchAllIssues(onProgress?: (fetched: number, total: number) => void): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    const pageSize = 100;
    let startAt = 0;
    let total = 0;

    do {
      const response = await this.http.get("/search", {
        params: {
          jql: `project = ${this.projectKey} ORDER BY created ASC`,
          startAt,
          maxResults: pageSize,
          expand: "changelog",
          fields: "summary,issuetype,status,created,resolutiondate,assignee,priority",
        },
      });

      const data = response.data;
      total = data.total;
      issues.push(...data.issues);
      onProgress?.(issues.length, total);

      startAt += pageSize;

      // Avoid hammering Jira Server
      if (startAt < total) {
        await sleep(200);
      }
    } while (startAt < total);

    return issues;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

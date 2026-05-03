import axios, { AxiosInstance } from "axios";
import { JiraIssue, JiraSprint, JiraStatus, JiraBoardConfig } from "./types";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  boardId: number;
}

export class JiraClient {
  private http: AxiosInstance;
  private boardId: number;

  constructor(config: JiraConfig) {
    this.boardId = config.boardId;
    this.http = axios.create({
      baseURL: config.baseUrl,
      auth: { username: config.email, password: config.apiToken },
      headers: { "Content-Type": "application/json" },
    });
  }

  async fetchAllIssues(
    onProgress?: (fetched: number, total: number) => void,
    updatedSince?: string,
  ): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    const pageSize = 100;
    let startAt = 0;
    let total = 0;

    const jqlDate = updatedSince ? updatedSince.slice(0, 16).replace("T", " ") : null;

    do {
      const params: Record<string, string | number> = {
        startAt,
        maxResults: pageSize,
        expand: "changelog",
        fields: "summary,issuetype,status,created,resolutiondate,assignee,priority,customfield_10020,timeoriginalestimate",
      };
      if (jqlDate) {
        params.jql = `updated >= "${jqlDate}"`;
      }

      const response = await this.http.get(`/rest/agile/1.0/board/${this.boardId}/issue`, { params });

      const data = response.data;
      total = data.total;
      issues.push(...data.issues);
      onProgress?.(issues.length, total);

      startAt += pageSize;

      if (startAt < total) {
        await sleep(200);
      }
    } while (startAt < total);

    return issues;
  }

  async fetchAllStatuses(): Promise<JiraStatus[]> {
    // Liste globale des statuts de l'instance avec statusCategory.
    const response = await this.http.get(`/rest/api/2/status`);
    return response.data as JiraStatus[];
  }

  async fetchBoardConfiguration(): Promise<JiraBoardConfig> {
    const response = await this.http.get(
      `/rest/agile/1.0/board/${this.boardId}/configuration`,
    );
    return response.data as JiraBoardConfig;
  }

  async fetchAllSprints(): Promise<JiraSprint[]> {
    const sprints: JiraSprint[] = [];
    const pageSize = 50;
    let startAt = 0;
    let isLast = false;

    do {
      const response = await this.http.get(`/rest/agile/1.0/board/${this.boardId}/sprint`, {
        params: { startAt, maxResults: pageSize },
      });
      const data = response.data;
      sprints.push(...data.values);
      isLast = data.isLast;
      startAt += pageSize;
      if (!isLast) await sleep(200);
    } while (!isLast);

    return sprints;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

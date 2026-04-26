import { JiraClient } from "./jira/client";
import { JiraIssue, StoredIssue, Transition } from "./jira/types";
import { openDb, upsertIssues, replaceTransitions, logSync } from "./db/store";

interface SyncConfig {
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    boardId: number;
  };
  db: { path: string };
}

export async function sync(config: SyncConfig): Promise<void> {
  const db = openDb(config.db.path);
  const client = new JiraClient(config.jira);

  console.log(`Sync projet ${config.jira.projectKey}...`);

  const rawIssues = await client.fetchAllIssues((fetched, total) => {
    process.stdout.write(`\r  ${fetched}/${total} issues récupérées`);
  });
  console.log(`\n  ${rawIssues.length} issues récupérées depuis Jira`);

  const issues: StoredIssue[] = rawIssues.map(mapIssue);
  const allTransitions: Array<{ key: string; transitions: Transition[] }> = rawIssues.map((issue) => ({
    key: issue.key,
    transitions: extractTransitions(issue),
  }));

  upsertIssues(db, issues);

  for (const { key, transitions } of allTransitions) {
    replaceTransitions(db, key, transitions);
  }

  logSync(db, config.jira.projectKey, rawIssues.length);
  console.log(`Sync terminé. ${rawIssues.length} issues stockées.`);
}

function mapIssue(issue: JiraIssue): StoredIssue {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    issueType: issue.fields.issuetype.name,
    createdAt: issue.fields.created,
    resolvedAt: issue.fields.resolutiondate ?? null,
    currentStatus: issue.fields.status.name,
    assignee: issue.fields.assignee?.displayName ?? null,
    priority: issue.fields.priority?.name ?? null,
  };
}

function extractTransitions(issue: JiraIssue): Transition[] {
  if (!issue.changelog?.histories) return [];

  const transitions: Transition[] = [];

  for (const history of issue.changelog.histories) {
    for (const item of history.items) {
      if (item.field === "status") {
        transitions.push({
          issueKey: issue.key,
          fromStatus: item.fromString ?? null,
          toStatus: item.toString ?? "",
          transitionedAt: history.created,
        });
      }
    }
  }

  return transitions;
}

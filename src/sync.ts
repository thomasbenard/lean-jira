import { JiraClient } from "./jira/client";
import { JiraIssue, StoredIssue, StoredSprint, Transition } from "./jira/types";
import { openDb, upsertIssues, upsertSprints, replaceTransitions, logSync } from "./db/store";

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

  const rawSprints = await client.fetchAllSprints();
  const sprints: StoredSprint[] = rawSprints.map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    startDate: s.startDate ?? null,
    endDate: s.endDate ?? null,
    boardId: s.originBoardId ?? config.jira.boardId,
  }));
  upsertSprints(db, sprints);
  const activeSprintIds = new Set(rawSprints.filter((s) => s.state === "active").map((s) => s.id));
  console.log(`  ${sprints.length} sprints récupérés (${activeSprintIds.size} actif(s))`);

  const rawIssues = await client.fetchAllIssues((fetched, total) => {
    process.stdout.write(`\r  ${fetched}/${total} issues récupérées`);
  });
  console.log(`\n  ${rawIssues.length} issues récupérées depuis Jira`);

  const issues: StoredIssue[] = rawIssues.map((i) => mapIssue(i, activeSprintIds));
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

function mapIssue(issue: JiraIssue, activeSprintIds: Set<number>): StoredIssue {
  // Une issue peut référencer plusieurs sprints historiques (closed/active/future).
  // On retient uniquement le sprint actif courant si l'issue y est encore rattachée.
  const sprintField = issue.fields.customfield_10020 ?? null;
  const activeSprint = sprintField?.find((s) => activeSprintIds.has(s.id));

  return {
    key: issue.key,
    summary: issue.fields.summary,
    issueType: issue.fields.issuetype.name,
    createdAt: issue.fields.created,
    resolvedAt: issue.fields.resolutiondate ?? null,
    currentStatus: issue.fields.status.name,
    assignee: issue.fields.assignee?.displayName ?? null,
    priority: issue.fields.priority?.name ?? null,
    currentSprintId: activeSprint?.id ?? null,
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

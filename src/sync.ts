import { JiraClient } from "./jira/client";
import { type FieldChange, type JiraIssue, type StoredIssue, type StoredSprint, type StoredStatus, type Transition } from "./jira/types";
import { openDb, upsertIssues, upsertSprints, upsertStatuses, replaceAllTransitions, replaceAllFieldChanges, logSync, getLastSyncDate } from "./db/store";

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

  const rawStatuses = await client.fetchAllStatuses();
  const statuses: StoredStatus[] = rawStatuses.map((s) => ({
    name: s.name,
    categoryKey: s.statusCategory.key,
    categoryName: s.statusCategory.name,
  }));
  upsertStatuses(db, statuses);
  const doneCount = statuses.filter((s) => s.categoryKey === "done").length;
  console.log(`  ${statuses.length} statuts récupérés (${doneCount} en catégorie 'done')`);

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

  const lastSyncDate = getLastSyncDate(db, config.jira.projectKey);
  if (lastSyncDate) {
    console.log(`  Sync incrémental depuis ${lastSyncDate}`);
  } else {
    console.log(`  Premier sync — récupération complète`);
  }

  const rawIssues = await client.fetchAllIssues((fetched, total) => {
    process.stdout.write(`\r  ${fetched}/${total} issues récupérées`);
  }, lastSyncDate ?? undefined);
  console.log(`\n  ${rawIssues.length} issues récupérées depuis Jira`);

  const issues: StoredIssue[] = [];
  const allTransitions: { key: string; transitions: Transition[] }[] = [];
  const allFieldChanges: { key: string; changes: FieldChange[] }[] = [];
  for (const issue of rawIssues) {
    issues.push(mapIssue(issue, activeSprintIds));
    allTransitions.push({ key: issue.key, transitions: extractTransitions(issue) });
    allFieldChanges.push({ key: issue.key, changes: extractFieldChanges(issue) });
  }

  upsertIssues(db, issues);
  replaceAllTransitions(db, allTransitions);
  replaceAllFieldChanges(db, allFieldChanges);

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
    originalEstimateSeconds: issue.fields.timeoriginalestimate ?? null,
  };
}

const WATCHED_FIELDS = new Set(["description", "summary", "Story Points", "Sprint"]);

function extractFieldChanges(issue: JiraIssue): FieldChange[] {
  if (!issue.changelog?.histories) {return [];}

  const changes: FieldChange[] = [];
  for (const history of issue.changelog.histories) {
    for (const item of history.items) {
      if (WATCHED_FIELDS.has(item.field)) {
        changes.push({
          issueKey: issue.key,
          fieldName: item.field,
          fromValue: item.fromString ?? null,
          toValue: item.toString ?? null,
          changedAt: history.created,
        });
      }
    }
  }
  return changes;
}

function extractTransitions(issue: JiraIssue): Transition[] {
  if (!issue.changelog?.histories) {return [];}

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

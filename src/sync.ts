import { createJiraClient } from "./jira/clientFactory";
import { type FieldChange, type JiraIssue, type StoredIssue, type StoredSprint, type StoredStatus, type Transition } from "./jira/types";
import { type EstimationConfig, resolveEstimationField } from "./metrics/types";
import { t } from "./i18n/index";
import { now } from "./clock";
import type { Store } from "./store/types";

interface SyncConfig {
  jira: {
    baseUrl: string;
    email?: string;
    apiToken?: string;
    personalAccessToken?: string;
    projectKey: string;
    boardId: number;
    mode?: "real" | "fake";
    frozenNow?: string;
    fixturesPath?: string;
  };
  db: { path: string };
  estimation?: EstimationConfig;
}

export async function sync(store: Store, config: SyncConfig): Promise<void> {
  const client = createJiraClient(config.jira);

  console.log(t("sync.start", { projectKey: config.jira.projectKey }));

  const rawStatuses = await client.fetchAllStatuses();
  const statuses: StoredStatus[] = rawStatuses.map((s) => ({
    name: s.name,
    categoryKey: s.statusCategory.key,
    categoryName: s.statusCategory.name,
  }));
  store.statuses.upsertMany(statuses);
  const doneCount = statuses.filter((s) => s.categoryKey === "done").length;
  console.log(t("sync.statusesFetched", { count: statuses.length, doneCount }));

  const rawSprints = await client.fetchAllSprints();
  const sprints: StoredSprint[] = rawSprints.map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    startDate: s.startDate ?? null,
    endDate: s.endDate ?? null,
    boardId: s.originBoardId ?? config.jira.boardId,
  }));
  store.sprints.upsertMany(sprints);
  const activeSprintIds = new Set(rawSprints.filter((s) => s.state === "active").map((s) => s.id));
  console.log(t("sync.sprintsFetched", { count: sprints.length, activeCount: activeSprintIds.size }));

  const currentMethod = config.estimation?.method ?? "time";
  const storedMethod = store.appConfig.get("estimation_method") ?? "time";

  let lastSyncDate = store.syncLog.lastByProject(config.jira.projectKey)?.syncedAt ?? null;
  if (storedMethod !== currentMethod && lastSyncDate !== null) {
    console.warn(t("sync.estimationMethodChanged", { from: storedMethod, to: currentMethod }));
    lastSyncDate = null;
  }

  if (lastSyncDate) {
    console.log(t("sync.incrementalFrom", { date: lastSyncDate }));
  } else {
    console.log(t("sync.firstSync"));
  }

  const rawIssues = await client.fetchAllIssues((fetched, total) => {
    process.stdout.write(t("sync.issuesFetching", { fetched, total }));
  }, lastSyncDate ?? undefined);
  console.log(t("sync.issuesFetched", { count: rawIssues.length }));

  const issues: StoredIssue[] = [];
  const allTransitions: { key: string; rows: Transition[] }[] = [];
  const allFieldChanges: { key: string; rows: FieldChange[] }[] = [];
  const allIssueSprints: { key: string; sprintIds: number[] }[] = [];
  for (const issue of rawIssues) {
    issues.push(mapIssue(issue, activeSprintIds, config.estimation));
    allTransitions.push({ key: issue.key, rows: extractTransitions(issue) });
    allFieldChanges.push({ key: issue.key, rows: extractFieldChanges(issue) });
    allIssueSprints.push({ key: issue.key, sprintIds: (issue.fields.customfield_10020 ?? []).map((s) => s.id) });
  }

  store.issues.upsertMany(issues);
  store.transitions.replaceForIssues(allTransitions);
  store.issueFieldChanges.replaceForIssues(allFieldChanges);
  store.issueSprints.replaceForIssues(allIssueSprints);

  store.syncLog.append({ syncedAt: now().toISOString(), projectKey: config.jira.projectKey, issuesCount: rawIssues.length });
  store.appConfig.set("estimation_method", currentMethod);
  console.log(t("sync.done", { count: rawIssues.length }));
}

const VALID_SIZE_LABELS = new Set(["XS", "S", "M", "L", "XL"]);

function extractEstimation(
  fields: JiraIssue["fields"],
  cfg: EstimationConfig | undefined,
): { storyPoints: number | null; sizeLabel: string | null } {
  if (!cfg || cfg.method === "time" || cfg.method === "none") {
    return { storyPoints: null, sizeLabel: null };
  }

  const fieldName = resolveEstimationField(cfg);
  if (!fieldName) { return { storyPoints: null, sizeLabel: null }; }
  const raw = fields[fieldName];

  if (cfg.method === "story-points" || cfg.method === "numeric") {
    const v = typeof raw === "number" ? raw : null;
    return { storyPoints: v != null && v > 0 ? v : null, sizeLabel: null };
  }

  // cfg.method === "t-shirt" (seul cas restant après narrowing)
  const str = typeof raw === "string" ? raw
    : (raw as { value?: string } | null)?.value ?? null;
  const label = str?.toUpperCase().trim() ?? null;
  if (label && !VALID_SIZE_LABELS.has(label)) {
    console.warn(t("sync.sizeLabelUnrecognized", { value: str ?? "" }));
  }
  return { storyPoints: null, sizeLabel: VALID_SIZE_LABELS.has(label ?? "") ? label : null };
}

function mapIssue(issue: JiraIssue, activeSprintIds: Set<number>, estimationCfg?: EstimationConfig): StoredIssue {
  // Une issue peut référencer plusieurs sprints historiques (closed/active/future).
  // On retient uniquement le sprint actif courant si l'issue y est encore rattachée.
  const sprintField = issue.fields.customfield_10020 ?? null;
  const activeSprint = sprintField?.find((s) => activeSprintIds.has(s.id));
  const { storyPoints, sizeLabel } = extractEstimation(issue.fields, estimationCfg);

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
    storyPoints,
    sizeLabel,
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

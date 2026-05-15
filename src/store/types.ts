export interface IssueRecord {
  key: string;
  summary: string;
  issueType: string;
  createdAt: string;
  resolvedAt: string | null;
  currentStatus: string;
  assignee: string | null;
  priority: string | null;
  currentSprintId: number | null;
  originalEstimateSeconds: number | null;
  storyPoints: number | null;
  sizeLabel: string | null;
}

export interface TransitionRecord {
  id: number;
  issueKey: string;
  fromStatus: string | null;
  toStatus: string;
  transitionedAt: string;
}

export interface SprintRecord {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  boardId: number;
}

export interface StatusRecord {
  name: string;
  categoryKey: string;
  categoryName: string;
}

export interface IssueFieldChangeRecord {
  issueKey: string;
  fieldName: string;
  fromValue: string | null;
  toValue: string | null;
  changedAt: string;
}

export interface IssueSprintRecord {
  issueKey: string;
  sprintId: number;
}

export interface SnapshotRecord {
  snapshotDate: string;
  metricName: string;
  bucket: string;
  stat: string;
  value: number;
}

export interface SyncLogRecord {
  syncedAt: string;
  issuesCount: number;
  projectKey: string;
}

export interface ReadStore {
  issues: {
    all(): IssueRecord[];
    byKey(key: string): IssueRecord | null;
  };
  transitions: {
    all(): TransitionRecord[];
    byIssue(key: string): TransitionRecord[];
  };
  sprints: {
    all(): SprintRecord[];
    byId(id: number): SprintRecord | null;
  };
  statuses: {
    all(): StatusRecord[];
  };
  issueFieldChanges: {
    byIssueAndField(key: string, field: string): IssueFieldChangeRecord[];
  };
  issueSprints: {
    bySprint(sprintId: number): IssueSprintRecord[];
    byIssue(key: string): IssueSprintRecord[];
  };
  snapshots: {
    all(): SnapshotRecord[];
    byDate(date: string): SnapshotRecord[];
  };
  appConfig: {
    get(key: string): string | null;
  };
  syncLog: {
    lastByProject(projectKey: string): SyncLogRecord | null;
  };
}

export interface WriteStore {
  issues: {
    upsertMany(rows: IssueRecord[]): void;
  };
  transitions: {
    replaceForIssue(key: string, rows: Omit<TransitionRecord, "id">[]): void;
    replaceForIssues(items: { key: string; rows: Omit<TransitionRecord, "id">[] }[]): void;
  };
  sprints: {
    upsertMany(rows: SprintRecord[]): void;
  };
  statuses: {
    upsertMany(rows: StatusRecord[]): void;
  };
  issueFieldChanges: {
    replaceForIssues(items: { key: string; rows: IssueFieldChangeRecord[] }[]): void;
  };
  issueSprints: {
    replaceForIssues(items: { key: string; sprintIds: number[] }[]): void;
  };
  snapshots: {
    replaceAll(rows: SnapshotRecord[]): void;
  };
  appConfig: {
    set(key: string, value: string): void;
  };
  syncLog: {
    append(row: SyncLogRecord): void;
  };
  transaction<T>(fn: () => T): T;
}

// pourquoi : `interface Store extends ReadStore, WriteStore {}` échoue avec
// "Named property 'issues' of types ReadStore and WriteStore are not identical"
// car les sous-namespaces (issues, transitions, …) ont des shapes différents.
// Une intersection préserve les deux ensembles de méthodes (lecture + écriture).
export type Store = ReadStore & WriteStore;

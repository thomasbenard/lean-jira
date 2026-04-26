export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    issuetype: { name: string };
    status: { name: string };
    created: string;
    resolutiondate: string | null;
    assignee: { displayName: string } | null;
    priority: { name: string } | null;
    customfield_10020?: JiraSprint[] | null;
    timeoriginalestimate?: number | null;
  };
  changelog?: {
    histories: ChangelogHistory[];
  };
}

export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
  startDate?: string;
  endDate?: string;
  originBoardId?: number;
}

export interface ChangelogHistory {
  id: string;
  created: string;
  items: ChangelogItem[];
}

export interface ChangelogItem {
  field: string;
  fromString: string | null;
  toString: string | null;
}

export interface Transition {
  issueKey: string;
  fromStatus: string | null;
  toStatus: string;
  transitionedAt: string;
}

export interface StoredIssue {
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
}

export interface StoredSprint {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  boardId: number;
}

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
  };
  changelog?: {
    histories: ChangelogHistory[];
  };
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
}

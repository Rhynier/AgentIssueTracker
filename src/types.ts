export type IssueClassification = "bug" | "improvement" | "feature";

export type IssueStatus =
  | "created"
  | "in_progress"
  | "completed"
  | "in_review"
  | "closed"
  | "rejected";

export interface HistoryEntry {
  timestamp: string;
  agent: string;
  action: string;
}

export interface Comment {
  timestamp: string;
  agent: string;
  text: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  classification: IssueClassification;
  createdAt: string;
  modifiedAt: string;
  status: IssueStatus;
  history: HistoryEntry[];
  comments: Comment[];
}

export interface IssueStore {
  issues: Issue[];
}

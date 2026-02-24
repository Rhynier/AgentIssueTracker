import { v4 as uuidv4 } from "uuid";
import { loadIssues, saveIssues } from "./storage.js";
import type { Issue, IssueClassification, IssueStatus } from "./types.js";

let store = loadIssues();

function now(): string {
  return new Date().toISOString();
}

export function getAllIssues(): Issue[] {
  return [...store.issues];
}

export function getIssuesByStatus(status?: IssueStatus): Issue[] {
  if (!status) return getAllIssues();
  return store.issues.filter((i) => i.status === status);
}

export function listIssues(
  status?: IssueStatus,
  classification?: IssueClassification
): Issue[] {
  return store.issues.filter(
    (i) =>
      (status === undefined || i.status === status) &&
      (classification === undefined || i.classification === classification)
  );
}

/**
 * Tool: add_issue
 * Creates a new issue with status "created".
 */
export async function addIssue(
  title: string,
  description: string,
  classification: IssueClassification,
  agent: string
): Promise<Issue> {
  const timestamp = now();
  const issue: Issue = {
    id: uuidv4(),
    title,
    description,
    classification,
    createdAt: timestamp,
    modifiedAt: timestamp,
    status: "created",
    history: [
      {
        timestamp,
        agent,
        action: `Issue created with classification "${classification}"`,
      },
    ],
    comments: [],
  };
  store.issues.push(issue);
  await saveIssues(store);
  return issue;
}

/**
 * Tool: get_next_issue
 * Returns the oldest issue with status "created" (FIFO).
 * Sets its status to "in_progress" and records a history entry.
 * Returns null if no issues are available.
 */
export async function getNextIssue(
  agent: string,
  classification?: IssueClassification
): Promise<Issue | null> {
  const candidates = store.issues
    .map((issue, index) => ({ issue, index }))
    .filter(
      ({ issue }) =>
        issue.status === "created" &&
        (classification === undefined || issue.classification === classification)
    );

  if (candidates.length === 0) return null;

  // FIFO: take the first candidate (lowest array index = oldest created)
  const { issue, index } = candidates[0]!;

  const timestamp = now();
  store.issues[index] = {
    ...issue,
    status: "in_progress",
    modifiedAt: timestamp,
    history: [
      ...issue.history,
      {
        timestamp,
        agent,
        action: "Issue picked up and set to in_progress",
      },
    ],
  };

  await saveIssues(store);
  return store.issues[index]!;
}

/**
 * Tool: return_issue
 * Sets the issue back to "created", adds a comment, adds a history entry.
 * Throws if the issue is not found or is already closed.
 */
export async function returnIssue(
  issueId: string,
  comment: string,
  agent: string
): Promise<Issue> {
  const index = store.issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  const issue = store.issues[index]!;
  if (issue.status === "closed" || issue.status === "rejected") {
    throw new Error(
      `Cannot return issue ${issueId}: it is already closed (${issue.status})`
    );
  }

  const timestamp = now();
  store.issues[index] = {
    ...issue,
    status: "created",
    modifiedAt: timestamp,
    history: [
      ...issue.history,
      {
        timestamp,
        agent,
        action: "Issue returned to created status",
      },
    ],
    comments: [...issue.comments, { timestamp, agent, text: comment }],
  };

  await saveIssues(store);
  return store.issues[index]!;
}

/**
 * Tool: complete_issue
 * Marks an issue as completed (ready for review).
 * Adds a comment and a history entry.
 * Throws if the issue is not found or is in a terminal state.
 */
export async function completeIssue(
  issueId: string,
  comment: string,
  agent: string
): Promise<Issue> {
  const index = store.issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  const issue = store.issues[index]!;
  if (issue.status === "closed" || issue.status === "rejected") {
    throw new Error(
      `Cannot complete issue ${issueId}: it is already closed (${issue.status})`
    );
  }

  const timestamp = now();
  store.issues[index] = {
    ...issue,
    status: "completed",
    modifiedAt: timestamp,
    history: [
      ...issue.history,
      {
        timestamp,
        agent,
        action: "Issue marked as completed, ready for review",
      },
    ],
    comments: [...issue.comments, { timestamp, agent, text: comment }],
  };

  await saveIssues(store);
  return store.issues[index]!;
}

/**
 * Tool: get_next_review_item
 * Returns the oldest issue with status "completed" (FIFO).
 * Sets its status to "in_review" and records a history entry.
 * Returns null if no issues are ready for review.
 */
export async function getNextReviewItem(
  agent: string
): Promise<Issue | null> {
  const candidates = store.issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => issue.status === "completed");

  if (candidates.length === 0) return null;

  const { issue, index } = candidates[0]!;

  const timestamp = now();
  store.issues[index] = {
    ...issue,
    status: "in_review",
    modifiedAt: timestamp,
    history: [
      ...issue.history,
      {
        timestamp,
        agent,
        action: "Issue picked up for review and set to in_review",
      },
    ],
  };

  await saveIssues(store);
  return store.issues[index]!;
}

/**
 * Tool: close_issue
 * Closes the issue with "closed" or "rejected".
 * Adds a comment and a history entry.
 * Throws if the issue is not found or already closed.
 */
export async function closeIssue(
  issueId: string,
  resolution: "closed" | "rejected",
  comment: string,
  agent: string
): Promise<Issue> {
  const index = store.issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  const issue = store.issues[index]!;
  if (issue.status === "closed" || issue.status === "rejected") {
    throw new Error(
      `Issue ${issueId} is already closed (${issue.status})`
    );
  }

  const timestamp = now();
  store.issues[index] = {
    ...issue,
    status: resolution,
    modifiedAt: timestamp,
    history: [
      ...issue.history,
      {
        timestamp,
        agent,
        action: `Issue closed as "${resolution}"`,
      },
    ],
    comments: [...issue.comments, { timestamp, agent, text: comment }],
  };

  await saveIssues(store);
  return store.issues[index]!;
}

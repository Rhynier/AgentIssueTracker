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
 * Returns the most recently created issue with status "created" (LIFO).
 * Sets its status to "in_progress" and records a history entry.
 * Returns null if no issues are available.
 */
export async function getNextIssue(agent: string): Promise<Issue | null> {
  const candidates = store.issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => issue.status === "created");

  if (candidates.length === 0) return null;

  // LIFO: take the last candidate (highest array index = most recently added)
  const { issue, index } = candidates[candidates.length - 1]!;

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
  if (issue.status === "completed" || issue.status === "rejected") {
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
 * Tool: close_issue
 * Closes the issue with "completed" or "rejected".
 * Adds a comment and a history entry.
 * Throws if the issue is not found or already closed.
 */
export async function closeIssue(
  issueId: string,
  resolution: "completed" | "rejected",
  comment: string,
  agent: string
): Promise<Issue> {
  const index = store.issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  const issue = store.issues[index]!;
  if (issue.status === "completed" || issue.status === "rejected") {
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

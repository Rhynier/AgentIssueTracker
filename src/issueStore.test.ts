import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// issueStore.ts has module-level state (`let store = loadIssues()`).
// To isolate each test we reset modules and re-import after setting up
// a fresh storage mock via vi.doMock (non-hoisted, so we can call it
// inside beforeEach after vi.resetModules()).

let mockSaveIssues: ReturnType<typeof vi.fn>;
let store: typeof import("./issueStore.js");

beforeEach(async () => {
  vi.resetModules();
  mockSaveIssues = vi.fn().mockResolvedValue(undefined);
  vi.doMock("./storage.js", () => ({
    loadIssues: vi.fn(() => ({ issues: [] })),
    saveIssues: mockSaveIssues,
    DATA_FILE: "/mock/issues.json",
  }));
  store = await import("./issueStore.js");
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// addIssue
// ---------------------------------------------------------------------------
describe("addIssue", () => {
  it("returns an issue with the provided fields", async () => {
    const issue = await store.addIssue("Fix login", "Login broken", "bug", "agentA");

    expect(issue.title).toBe("Fix login");
    expect(issue.description).toBe("Login broken");
    expect(issue.classification).toBe("bug");
  });

  it("assigns a UUID id", async () => {
    const issue = await store.addIssue("T", "D", "feature", "agentA");
    expect(issue.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("sets status to 'created'", async () => {
    const issue = await store.addIssue("T", "D", "improvement", "agentA");
    expect(issue.status).toBe("created");
  });

  it("adds a single history entry describing the creation", async () => {
    const issue = await store.addIssue("T", "D", "bug", "agentA");
    expect(issue.history).toHaveLength(1);
    expect(issue.history[0]?.agent).toBe("agentA");
    expect(issue.history[0]?.action).toContain("created");
  });

  it("starts with an empty comments array", async () => {
    const issue = await store.addIssue("T", "D", "bug", "agentA");
    expect(issue.comments).toEqual([]);
  });

  it("calls saveIssues once", async () => {
    await store.addIssue("T", "D", "bug", "agentA");
    expect(mockSaveIssues).toHaveBeenCalledTimes(1);
  });

  it("sets createdAt and modifiedAt to the same ISO timestamp", async () => {
    const issue = await store.addIssue("T", "D", "bug", "agentA");
    expect(issue.createdAt).toBe(issue.modifiedAt);
    expect(new Date(issue.createdAt).toISOString()).toBe(issue.createdAt);
  });
});

// ---------------------------------------------------------------------------
// getAllIssues / getIssuesByStatus
// ---------------------------------------------------------------------------
describe("getAllIssues", () => {
  it("returns an empty array when the store is empty", () => {
    expect(store.getAllIssues()).toEqual([]);
  });

  it("returns all issues after adding several", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    await store.addIssue("B", "D", "feature", "agentA");
    expect(store.getAllIssues()).toHaveLength(2);
  });

  it("returns a copy, not the internal array reference", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    const first = store.getAllIssues();
    const second = store.getAllIssues();
    expect(first).not.toBe(second);
  });
});

describe("getIssuesByStatus", () => {
  it("returns all issues when called with no argument", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    await store.addIssue("B", "D", "feature", "agentA");
    expect(store.getIssuesByStatus()).toHaveLength(2);
  });

  it("filters to only the requested status", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    await store.addIssue("B", "D", "feature", "agentA");
    // Pick the first one so it becomes in_progress
    await store.getNextIssue("agentB");

    const created = store.getIssuesByStatus("created");
    const inProgress = store.getIssuesByStatus("in_progress");
    expect(created).toHaveLength(1);
    expect(inProgress).toHaveLength(1);
  });

  it("returns an empty array when no issues match the status", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    expect(store.getIssuesByStatus("closed")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getNextIssue
// ---------------------------------------------------------------------------
describe("getNextIssue", () => {
  it("returns null when the store is empty", async () => {
    const result = await store.getNextIssue("agentA");
    expect(result).toBeNull();
  });

  it("returns null when there are no 'created' issues", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA"); // picks it up → in_progress
    const result = await store.getNextIssue("agentB");
    expect(result).toBeNull();
  });

  it("transitions the issue to 'in_progress'", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    const picked = await store.getNextIssue("agentB");
    expect(picked?.status).toBe("in_progress");
  });

  it("appends a history entry for the pick-up", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    const picked = await store.getNextIssue("agentB");
    const lastEntry = picked?.history.at(-1);
    expect(lastEntry?.agent).toBe("agentB");
    expect(lastEntry?.action).toContain("in_progress");
  });

  it("returns issues in FIFO order (oldest created first)", async () => {
    const first = await store.addIssue("First", "D", "bug", "agentA");
    await store.addIssue("Second", "D", "bug", "agentA");

    const picked = await store.getNextIssue("agentB");
    expect(picked?.id).toBe(first.id);
    expect(picked?.title).toBe("First");
  });

  it("calls saveIssues after picking", async () => {
    await store.addIssue("A", "D", "bug", "agentA");
    mockSaveIssues.mockClear();
    await store.getNextIssue("agentB");
    expect(mockSaveIssues).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// returnIssue
// ---------------------------------------------------------------------------
describe("returnIssue", () => {
  it("throws when the issue ID is not found", async () => {
    await expect(
      store.returnIssue("00000000-0000-4000-8000-000000000000", "reason", "agentA"),
    ).rejects.toThrow("not found");
  });

  it("throws when the issue is already 'closed'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA"); // → in_progress
    await store.closeIssue(issue.id, "closed", "done", "agentA");

    await expect(
      store.returnIssue(issue.id, "oops", "agentA"),
    ).rejects.toThrow("already closed");
  });

  it("throws when the issue is already 'rejected'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA"); // → in_progress
    await store.closeIssue(issue.id, "rejected", "not valid", "agentA");

    await expect(
      store.returnIssue(issue.id, "oops", "agentA"),
    ).rejects.toThrow("already closed");
  });

  it("sets the issue status back to 'created'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA"); // → in_progress
    const returned = await store.returnIssue(issue.id, "needs more info", "agentA");
    expect(returned.status).toBe("created");
  });

  it("appends the comment to the issue", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    const returned = await store.returnIssue(issue.id, "needs more info", "agentB");
    expect(returned.comments).toHaveLength(1);
    expect(returned.comments[0]?.text).toBe("needs more info");
    expect(returned.comments[0]?.agent).toBe("agentB");
  });

  it("appends a history entry for the return", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    const returned = await store.returnIssue(issue.id, "reason", "agentB");
    const lastEntry = returned.history.at(-1);
    expect(lastEntry?.agent).toBe("agentB");
    expect(lastEntry?.action).toContain("returned");
  });

  it("calls saveIssues after returning", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    mockSaveIssues.mockClear();
    await store.returnIssue(issue.id, "reason", "agentB");
    expect(mockSaveIssues).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// closeIssue
// ---------------------------------------------------------------------------
describe("closeIssue", () => {
  it("throws when the issue ID is not found", async () => {
    await expect(
      store.closeIssue("00000000-0000-4000-8000-000000000000", "closed", "done", "agentA"),
    ).rejects.toThrow("not found");
  });

  it("throws when the issue is already 'closed'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    await store.closeIssue(issue.id, "closed", "done", "agentA");

    await expect(
      store.closeIssue(issue.id, "closed", "again", "agentA"),
    ).rejects.toThrow("already closed");
  });

  it("throws when the issue is already 'rejected'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    await store.closeIssue(issue.id, "rejected", "no", "agentA");

    await expect(
      store.closeIssue(issue.id, "rejected", "again", "agentA"),
    ).rejects.toThrow("already closed");
  });

  it("sets status to 'closed' when resolution is 'closed'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    const closed = await store.closeIssue(issue.id, "closed", "done", "agentA");
    expect(closed.status).toBe("closed");
  });

  it("sets status to 'rejected' when resolution is 'rejected'", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    const closed = await store.closeIssue(issue.id, "rejected", "not valid", "agentA");
    expect(closed.status).toBe("rejected");
  });

  it("appends the comment to the issue", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    const closed = await store.closeIssue(issue.id, "closed", "all done", "agentB");
    expect(closed.comments).toHaveLength(1);
    expect(closed.comments[0]?.text).toBe("all done");
    expect(closed.comments[0]?.agent).toBe("agentB");
  });

  it("appends a history entry for the closure", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    const closed = await store.closeIssue(issue.id, "closed", "done", "agentB");
    const lastEntry = closed.history.at(-1);
    expect(lastEntry?.agent).toBe("agentB");
    expect(lastEntry?.action).toContain("closed");
  });

  it("calls saveIssues after closing", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    await store.getNextIssue("agentA");
    mockSaveIssues.mockClear();
    await store.closeIssue(issue.id, "closed", "done", "agentA");
    expect(mockSaveIssues).toHaveBeenCalledTimes(1);
  });

  it("can close a 'created' issue directly (no in_progress step required)", async () => {
    const issue = await store.addIssue("A", "D", "bug", "agentA");
    const closed = await store.closeIssue(issue.id, "rejected", "duplicate", "agentA");
    expect(closed.status).toBe("rejected");
  });
});

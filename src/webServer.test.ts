import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "./types.js";

// Shared mock functions — reassigned in beforeEach so each test starts fresh.
let mockGetAllIssues: ReturnType<typeof vi.fn>;
let mockGetIssuesByStatus: ReturnType<typeof vi.fn>;

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    title: "Sample issue",
    description: "A description",
    classification: "bug",
    createdAt: "2024-01-01T12:00:00.000Z",
    modifiedAt: "2024-01-02T12:00:00.000Z",
    status: "created",
    history: [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        agent: "agentA",
        action: 'Issue created with classification "bug"',
      },
    ],
    comments: [],
    ...overrides,
  };
}

let webServer: typeof import("./webServer.js");

beforeEach(async () => {
  vi.resetModules();
  mockGetAllIssues = vi.fn().mockReturnValue([]);
  mockGetIssuesByStatus = vi.fn().mockReturnValue([]);
  vi.doMock("./issueStore.js", () => ({
    getAllIssues: mockGetAllIssues,
    getIssuesByStatus: mockGetIssuesByStatus,
  }));
  webServer = await import("./webServer.js");
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
describe("GET /health", () => {
  it("returns 200 with JSON status ok", async () => {
    mockGetAllIssues.mockReturnValue([]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", issueCount: 0 });
  });

  it("reflects the current issue count", async () => {
    mockGetAllIssues.mockReturnValue([makeIssue(), makeIssue({ id: "bbbbbbbb-0000-4000-8000-000000000002" })]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/health");
    expect(res.body.issueCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------
describe("GET /", () => {
  it("returns 200 with HTML content-type", async () => {
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it("calls getAllIssues when no status filter is provided", async () => {
    mockGetAllIssues.mockReturnValue([makeIssue()]);
    const app = webServer.createWebServer();
    await supertest(app).get("/");
    expect(mockGetAllIssues).toHaveBeenCalledTimes(1);
    expect(mockGetIssuesByStatus).not.toHaveBeenCalled();
  });

  it("shows 'No issues found' when the list is empty", async () => {
    mockGetAllIssues.mockReturnValue([]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).toContain("No issues found");
  });

  it("renders the issue title in the response HTML", async () => {
    mockGetAllIssues.mockReturnValue([makeIssue({ title: "My special issue" })]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).toContain("My special issue");
  });

  it("renders all issues when multiple exist", async () => {
    mockGetAllIssues.mockReturnValue([
      makeIssue({ id: "id-1", title: "Issue Alpha" }),
      makeIssue({ id: "id-2", title: "Issue Beta" }),
    ]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).toContain("Issue Alpha");
    expect(res.text).toContain("Issue Beta");
  });

  it("shows the issue count in the subtitle", async () => {
    mockGetAllIssues.mockReturnValue([makeIssue()]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).toContain("1 issue(s)");
  });
});

// ---------------------------------------------------------------------------
// GET /?status=<filter>
// ---------------------------------------------------------------------------
describe("GET /?status=", () => {
  it("calls getIssuesByStatus with a valid status", async () => {
    mockGetIssuesByStatus.mockReturnValue([makeIssue({ status: "in_progress" })]);
    const app = webServer.createWebServer();
    await supertest(app).get("/?status=in_progress");
    expect(mockGetIssuesByStatus).toHaveBeenCalledWith("in_progress");
    expect(mockGetAllIssues).not.toHaveBeenCalled();
  });

  it("falls back to getAllIssues for an invalid status value", async () => {
    mockGetAllIssues.mockReturnValue([]);
    const app = webServer.createWebServer();
    await supertest(app).get("/?status=nonsense");
    expect(mockGetAllIssues).toHaveBeenCalledTimes(1);
    expect(mockGetIssuesByStatus).not.toHaveBeenCalled();
  });

  it("shows the active filter name in the subtitle", async () => {
    mockGetIssuesByStatus.mockReturnValue([]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/?status=completed");
    expect(res.text).toContain("completed");
  });

  it("accepts all four valid statuses", async () => {
    const statuses = ["created", "in_progress", "completed", "rejected"] as const;
    const app = webServer.createWebServer();
    for (const status of statuses) {
      mockGetIssuesByStatus.mockReturnValue([]);
      await supertest(app).get(`/?status=${status}`);
      expect(mockGetIssuesByStatus).toHaveBeenCalledWith(status);
      mockGetIssuesByStatus.mockClear();
    }
  });

  it("treats 'all' as no filter and calls getAllIssues", async () => {
    mockGetAllIssues.mockReturnValue([]);
    const app = webServer.createWebServer();
    await supertest(app).get("/?status=all");
    expect(mockGetAllIssues).toHaveBeenCalledTimes(1);
    expect(mockGetIssuesByStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
describe("HTML escaping", () => {
  it("escapes < and > in issue titles", async () => {
    mockGetAllIssues.mockReturnValue([
      makeIssue({ title: "<script>alert('xss')</script>" }),
    ]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).not.toContain("<script>");
    expect(res.text).toContain("&lt;script&gt;");
  });

  it("escapes & in issue descriptions", async () => {
    mockGetAllIssues.mockReturnValue([
      makeIssue({ description: "foo & bar" }),
    ]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).toContain("foo &amp; bar");
  });

  it("escapes quotes in comments", async () => {
    mockGetAllIssues.mockReturnValue([
      makeIssue({
        comments: [
          {
            timestamp: "2024-01-02T00:00:00.000Z",
            agent: 'agent"X"',
            text: 'said "hello"',
          },
        ],
      }),
    ]);
    const app = webServer.createWebServer();
    const res = await supertest(app).get("/");
    expect(res.text).toContain("&quot;hello&quot;");
  });
});

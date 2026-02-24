import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueStore } from "./types.js";

// Use a fresh temp directory and reset modules for each test so DATA_FILE
// is re-evaluated with the new env var.
let tempDir: string;
let testFile: string;
let storage: typeof import("./storage.js");

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ait-test-"));
  testFile = path.join(tempDir, "issues.json");
  process.env["ISSUES_FILE"] = testFile;
  vi.resetModules();
  storage = await import("./storage.js");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true });
  delete process.env["ISSUES_FILE"];
});

describe("loadIssues", () => {
  it("returns an empty store when the file does not exist", () => {
    const result = storage.loadIssues();
    expect(result).toEqual({ issues: [] });
  });

  it("parses and returns existing data from disk", () => {
    const data: IssueStore = {
      issues: [
        {
          id: "abc-123",
          title: "Test issue",
          description: "A test",
          classification: "bug",
          createdAt: "2024-01-01T00:00:00.000Z",
          modifiedAt: "2024-01-01T00:00:00.000Z",
          status: "created",
          history: [],
          comments: [],
        },
      ],
    };
    fs.writeFileSync(testFile, JSON.stringify(data), "utf-8");

    const result = storage.loadIssues();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.title).toBe("Test issue");
    expect(result.issues[0]?.status).toBe("created");
  });

  it("returns the full structure including history and comments", () => {
    const data: IssueStore = {
      issues: [
        {
          id: "xyz-456",
          title: "Another issue",
          description: "Desc",
          classification: "feature",
          createdAt: "2024-02-01T00:00:00.000Z",
          modifiedAt: "2024-02-02T00:00:00.000Z",
          status: "in_progress",
          history: [
            {
              timestamp: "2024-02-01T00:00:00.000Z",
              agent: "agentA",
              action: "created",
            },
          ],
          comments: [
            {
              timestamp: "2024-02-02T00:00:00.000Z",
              agent: "agentB",
              text: "noted",
            },
          ],
        },
      ],
    };
    fs.writeFileSync(testFile, JSON.stringify(data), "utf-8");

    const result = storage.loadIssues();
    expect(result.issues[0]?.history).toHaveLength(1);
    expect(result.issues[0]?.comments).toHaveLength(1);
    expect(result.issues[0]?.comments[0]?.text).toBe("noted");
  });
});

describe("saveIssues", () => {
  it("writes data that can be reloaded by loadIssues", async () => {
    const data: IssueStore = {
      issues: [
        {
          id: "save-001",
          title: "Saved issue",
          description: "Will be persisted",
          classification: "improvement",
          createdAt: "2024-03-01T00:00:00.000Z",
          modifiedAt: "2024-03-01T00:00:00.000Z",
          status: "closed",
          history: [],
          comments: [],
        },
      ],
    };

    await storage.saveIssues(data);
    const reloaded = storage.loadIssues();
    expect(reloaded.issues).toHaveLength(1);
    expect(reloaded.issues[0]?.id).toBe("save-001");
    expect(reloaded.issues[0]?.status).toBe("closed");
  });

  it("writes via a .tmp file then renames atomically", async () => {
    const tmpFile = testFile + ".tmp";
    let tmpExistedDuringSave = false;

    // Wrap fs.promises.rename to check if .tmp exists just before renaming
    const originalRename = fs.promises.rename;
    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockImplementation(async (src, dest) => {
        if (String(src) === tmpFile) {
          tmpExistedDuringSave = fs.existsSync(tmpFile);
        }
        return originalRename(src, dest);
      });

    await storage.saveIssues({ issues: [] });

    expect(tmpExistedDuringSave).toBe(true);
    expect(fs.existsSync(tmpFile)).toBe(false); // cleaned up after rename
    expect(fs.existsSync(testFile)).toBe(true);

    renameSpy.mockRestore();
  });

  it("writes valid JSON to disk", async () => {
    const data: IssueStore = { issues: [] };
    await storage.saveIssues(data);

    const raw = fs.readFileSync(testFile, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual({ issues: [] });
  });
});

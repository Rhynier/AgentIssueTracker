import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addIssue,
  getNextIssue,
  returnIssue,
  completeIssue,
  getNextReviewItem,
  closeIssue,
  listIssues,
  peekNextIssue,
} from "./issueStore.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "agent-issue-tracker",
    version: "1.0.0",
  });

  server.tool(
    "add_issue",
    "Create a new issue in the tracker",
    {
      title: z.string().describe("Short title for the issue"),
      description: z.string().describe("Detailed description of the issue"),
      classification: z
        .enum(["bug", "improvement", "feature"])
        .describe("Type of issue"),
      agent: z.string().describe("Name or ID of the agent creating this issue"),
    },
    async ({ title, description, classification, agent }) => {
      try {
        const issue = await addIssue(title, description, classification, agent);
        return {
          content: [
            {
              type: "text",
              text: `Issue created successfully.\nID: ${issue.id}\nTitle: ${issue.title}\nStatus: ${issue.status}\nCreated at: ${issue.createdAt}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_issues",
    "List issues filtered by status and/or classification. Read-only — does not claim or modify any issues.",
    {
      status: z
        .enum(["created", "in_progress", "completed", "in_review", "closed", "rejected"])
        .optional()
        .describe("Filter by issue status. Omit to include all statuses."),
      classification: z
        .enum(["bug", "improvement", "feature"])
        .optional()
        .describe("Filter by issue classification. Omit to include all types."),
      skip: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of matching issues to skip (for pagination). Defaults to 0."),
      take: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of issues to return. Omit to return all remaining."),
    },
    async ({ status, classification, skip, take }) => {
      try {
        const issues = listIssues(status, classification, skip, take);
        const summary = issues.map((i) => ({
          id: i.id,
          title: i.title,
          classification: i.classification,
          status: i.status,
          createdAt: i.createdAt,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: issues.length, issues: summary }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "peek_next_issue",
    "Preview the next available issue by classification priority without claiming it. " +
      "Checks classifications in the order given and returns the oldest 'created' issue " +
      "matching the first classification with available issues. Read-only — does not " +
      "change issue status.",
    {
      classifications: z
        .array(z.enum(["bug", "improvement", "feature"]))
        .min(1)
        .describe(
          "Ordered list of classifications to check. Returns the oldest 'created' issue " +
            "matching the first classification; if none, tries the next, and so on."
        ),
    },
    async ({ classifications }) => {
      try {
        const issue = peekNextIssue(classifications);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: "No issues available matching the requested classifications.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(issue, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_next_issue",
    "Retrieve the next available issue to work on (FIFO order). Sets status to in_progress. Optionally filter by classification to prioritize issue types.",
    {
      agent: z
        .string()
        .describe("Name or ID of the agent picking up this issue"),
      classification: z
        .enum(["bug", "improvement", "feature"])
        .optional()
        .describe(
          "Optional classification filter — only return issues of this type"
        ),
    },
    async ({ agent, classification }) => {
      try {
        const issue = await getNextIssue(agent, classification);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: "No issues available with status 'created'.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(issue, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "return_issue",
    "Return an issue to 'created' status with a comment explaining why",
    {
      issue_id: z.string().uuid().describe("UUID of the issue to return"),
      comment: z.string().describe("Reason for returning the issue"),
      agent: z
        .string()
        .describe("Name or ID of the agent returning the issue"),
    },
    async ({ issue_id, comment, agent }) => {
      try {
        const issue = await returnIssue(issue_id, comment, agent);
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issue.id} returned to 'created' status.\nComment recorded.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "complete_issue",
    "Mark an issue as completed and ready for code review",
    {
      issue_id: z.string().uuid().describe("UUID of the issue to complete"),
      comment: z
        .string()
        .describe("Summary of the work done on this issue"),
      agent: z
        .string()
        .describe("Name or ID of the agent completing this issue"),
    },
    async ({ issue_id, comment, agent }) => {
      try {
        const issue = await completeIssue(issue_id, comment, agent);
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issue.id} marked as 'completed' and ready for review.\nComment recorded.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_next_review_item",
    "Retrieve the next completed issue to review (FIFO order). Sets status to in_review.",
    {
      agent: z
        .string()
        .describe("Name or ID of the reviewing agent"),
    },
    async ({ agent }) => {
      try {
        const issue = await getNextReviewItem(agent);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: "No issues available with status 'completed'.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(issue, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "close_issue",
    "Close an issue as closed or rejected with a final comment",
    {
      issue_id: z.string().uuid().describe("UUID of the issue to close"),
      resolution: z
        .enum(["closed", "rejected"])
        .describe("Final resolution status"),
      comment: z
        .string()
        .describe("Final comment explaining the resolution"),
      agent: z
        .string()
        .describe("Name or ID of the agent closing the issue"),
    },
    async ({ issue_id, resolution, comment, agent }) => {
      try {
        const issue = await closeIssue(issue_id, resolution, comment, agent);
        return {
          content: [
            {
              type: "text",
              text: `Issue ${issue.id} closed as '${resolution}'.\nComment recorded.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

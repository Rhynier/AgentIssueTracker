import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addIssue,
  getNextIssue,
  returnIssue,
  closeIssue,
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
    "get_next_issue",
    "Retrieve the next available issue to work on (LIFO order). Sets status to in_progress.",
    {
      agent: z
        .string()
        .describe("Name or ID of the agent picking up this issue"),
    },
    async ({ agent }) => {
      try {
        const issue = await getNextIssue(agent);
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
    "close_issue",
    "Close an issue as completed or rejected with a final comment",
    {
      issue_id: z.string().uuid().describe("UUID of the issue to close"),
      resolution: z
        .enum(["completed", "rejected"])
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

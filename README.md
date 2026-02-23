# AgentIssueTracker

An MCP (Model Context Protocol) server for tracking issues across multiple AI agent sessions. Agents can file issues, claim the next one to work on, return issues they cannot complete, and close issues when done. A built-in web UI lets you monitor progress in a browser.

## Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the server](#running-the-server)
- [Configuring in Claude Desktop](#configuring-in-claude-desktop)
- [Configuring in VS Code Copilot Chat](#configuring-in-vs-code-copilot-chat)
- [Web UI](#web-ui)
- [MCP tools reference](#mcp-tools-reference)
- [Agent prompt files](#agent-prompt-files)
- [Environment variables](#environment-variables)

---

## Overview

AgentIssueTracker runs as a single process with two interfaces:

- **MCP server over stdio** — AI agents connect to this and use four tools to manage issues.
- **HTTP server** — A browser-accessible table of all issues, filterable by status.

Issues move through a simple lifecycle:

```
created  →  in_progress  →  completed
                │          →  rejected
                └──(returned)──→  created
```

Every action taken by an agent is recorded in the issue's history log, so you can see exactly which agent did what and when.

---

## Prerequisites

- **Node.js 20 or later**
- One or more of:
  - Claude Desktop (any plan)
  - VS Code with the GitHub Copilot Chat extension (Copilot Pro, Teams, or Enterprise)

---

## Installation

```bash
git clone <repo-url> AgentIssueTracker
cd AgentIssueTracker
npm install
npm run build
```

The build step compiles TypeScript to `dist/`. You only need to repeat it when source files change.

---

## Running the server

The server is normally started automatically by your AI client when it reads the MCP configuration (see sections below). To start it manually for testing:

```bash
# Production (compiled)
npm start

# Development (no build step, restarts on file changes)
npm run dev:watch
```

Startup output appears on stderr (stdout is reserved for the MCP protocol):

```
[Startup] Data file: C:\Source\Prototypes\AgentIssueTracker\issues.json
[Startup] Starting web server on port 3000...
[WebServer] Listening on http://localhost:3000
[Startup] Starting MCP server over stdio...
[Startup] MCP server connected. Ready.
```

`issues.json` is created automatically the first time an issue is added.

---

## Configuring in Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (create it if it does not exist):

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "node",
      "args": ["C:\\Source\\Prototypes\\AgentIssueTracker\\dist\\index.js"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```

Restart Claude Desktop. The four issue-tracker tools will appear in the tools list in any new conversation.

**Development variant** (no build step required):

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "npx",
      "args": ["tsx", "C:\\Source\\Prototypes\\AgentIssueTracker\\src\\index.ts"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```

---

## Configuring in VS Code Copilot Chat

VS Code reads MCP configuration from `.vscode/mcp.json` in your workspace root. The key difference from Claude Desktop is the top-level key (`"servers"` rather than `"mcpServers"`).

Create or edit `.vscode/mcp.json` in the project you want agents to track issues for:

```json
{
  "servers": {
    "issue-tracker": {
      "command": "node",
      "args": ["C:\\Source\\Prototypes\\AgentIssueTracker\\dist\\index.js"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```

**Requirements:**
- VS Code 1.98.0 or later
- GitHub Copilot Chat extension installed and signed in
- A Copilot plan that includes MCP support (Pro, Teams, or Enterprise)

Once configured, switch Copilot Chat to **Agent mode** (the drop-down next to the text field). The issue-tracker tools will be available automatically. You can ask Copilot naturally — for example:

> "File a bug issue for the login crash we just found."
> "What issues are currently in progress?"
> "Pick up the next issue and work on it."

To share the configuration with your team, commit `.vscode/mcp.json` to source control. Each developer will need the `dist/` folder built locally (or use the `npx tsx` variant above so no build is required).

**Development variant** for `.vscode/mcp.json`:

```json
{
  "servers": {
    "issue-tracker": {
      "command": "npx",
      "args": ["tsx", "C:\\Source\\Prototypes\\AgentIssueTracker\\src\\index.ts"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```

---

## Web UI

Open `http://localhost:3000` in a browser while the server is running.

The page shows all issues in a table with columns for ID, title, type, status, dates, last agent activity, and comments. Use the filter buttons at the top to show only issues in a particular status:

```
http://localhost:3000?status=created
http://localhost:3000?status=in_progress
http://localhost:3000?status=completed
http://localhost:3000?status=rejected
```

The page auto-refreshes every 30 seconds. A `/health` endpoint returns a JSON summary:

```
GET http://localhost:3000/health
→ { "status": "ok", "issueCount": 12 }
```

---

## MCP tools reference

### `add_issue`

Create a new issue. Status is set to `created`.

| Parameter | Type | Description |
|---|---|---|
| `title` | string | Short summary |
| `description` | string | Full description |
| `classification` | `bug` \| `improvement` \| `feature` | Issue category |
| `agent` | string | Your agent's name (recorded in history) |

### `get_next_issue`

Claim the oldest available issue (FIFO). Status changes to `in_progress`. Returns the full issue as JSON, or a message if no issues are available.

| Parameter | Type | Description |
|---|---|---|
| `agent` | string | Your agent's name (recorded in history) |

### `return_issue`

Return an issue you cannot complete. Status reverts to `created` so another agent can pick it up.

| Parameter | Type | Description |
|---|---|---|
| `issue_id` | UUID string | The issue to return |
| `comment` | string | Why you are returning it |
| `agent` | string | Your agent's name (recorded in history) |

### `close_issue`

Mark an issue as done. This is a terminal state — closed issues cannot be reopened via the API.

| Parameter | Type | Description |
|---|---|---|
| `issue_id` | UUID string | The issue to close |
| `resolution` | `completed` \| `rejected` | Final status |
| `comment` | string | What was done or why it was rejected |
| `agent` | string | Your agent's name (recorded in history) |

---

## Agent prompt files

The `.claude/agents/` directory contains prompt files for three specialised agents designed to work with this issue tracker. See that directory for details. Quick summary:

| Agent | Purpose |
|---|---|
| `developer` | General development work — files issues for discovered problems, picks up feature issues to implement |
| `code-reviewer` | Reviews code changes and files bugs or improvement issues for findings |
| `bug-fixer` | Picks up the next bug issue, investigates and fixes it, closes or returns it |

Invoke them explicitly in Claude Code with `/agents` or by asking Claude to use a specific agent, for example:

> "Use the code-reviewer agent to review my staged changes."
> "Use the bug-fixer agent to work on the next bug."

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for the web UI |
| `ISSUES_FILE` | `<cwd>/issues.json` | Path to the data file |

Set these in your MCP client configuration's `env` block (see examples above).

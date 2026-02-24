# Architecture

AgentIssueTracker is a single Node.js process that exposes two interfaces simultaneously:

- An **MCP server** over stdio, giving AI agents seven tools to manage issues.
- An **HTTP server** (Express) on a configurable port, giving humans a read-only web UI.

Both interfaces share the same in-memory store, which is persisted to a single JSON file.

---

## Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                         index.ts                            │
│   Entry point. Starts the web server, then connects the     │
│   MCP stdio transport. Both run in the same event loop.     │
└────────────────┬───────────────────────┬────────────────────┘
                 │                       │
     ┌───────────▼──────────┐ ┌──────────▼──────────┐
     │     mcpServer.ts     │ │    webServer.ts      │
     │  McpServer instance  │ │  Express app         │
     │  7 tool definitions  │ │  GET /  (HTML table) │
     │  Zod input schemas   │ │  GET /health  (JSON) │
     └───────────┬──────────┘ └──────────┬───────────┘
                 │                       │
                 └──────────┬────────────┘
                            │  read / mutate
                 ┌──────────▼────────────┐
                 │     issueStore.ts     │
                 │  Module-level store   │
                 │  All business logic   │
                 │  addIssue             │
                 │  listIssues (read)    │
                 │  getNextIssue         │
                 │  returnIssue          │
                 │  completeIssue        │
                 │  getNextReviewItem    │
                 │  closeIssue           │
                 │  getAllIssues         │
                 │  getIssuesByStatus    │
                 └──────────┬────────────┘
                            │  load / save
                 ┌──────────▼────────────┐
                 │      storage.ts       │
                 │  loadIssues() sync    │
                 │  saveIssues() async   │
                 │  Atomic write via tmp │
                 └──────────┬────────────┘
                            │
                      issues.json
```

`types.ts` defines the shared interfaces (`Issue`, `HistoryEntry`, `Comment`, `IssueStore`) imported by every other module. It contains no logic.

---

## Data Model

### Issue

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID v4) | Stable, unique identifier |
| `title` | `string` | Short summary |
| `description` | `string` | Full description |
| `classification` | `"bug" \| "improvement" \| "feature"` | Category |
| `createdAt` | ISO 8601 string | Set once on creation |
| `modifiedAt` | ISO 8601 string | Updated on every mutation |
| `status` | see below | Current lifecycle state |
| `history` | `HistoryEntry[]` | Append-only audit log |
| `comments` | `Comment[]` | Append-only comment thread |

### HistoryEntry

Every operation that mutates an issue appends one entry: `{ timestamp, agent, action }`. The `agent` field is always supplied by the calling agent — there is no authentication; agents are trusted to identify themselves accurately.

### Comment

`return_issue`, `complete_issue`, and `close_issue` each append a `{ timestamp, agent, text }` comment. Comments are separate from history entries: history records *what happened*, comments record *why*.

---

## Issue Lifecycle

```
          add_issue
              │
              ▼
          "created"  ◄──────────── return_issue (with comment)
              │                        ▲          ▲
              │  get_next_issue        │          │
              ▼                        │          │
          "in_progress"                │          │
              │                        │          │
              │  complete_issue        │          │
              ▼                        │          │
          "completed" ─────────────────┘          │
              │                                   │
              │  get_next_review_item              │
              ▼                                   │
          "in_review" ────────────────────────────┘
              │
        close_issue
       ┌──────┴──────┐
       ▼             ▼
  "closed"      "rejected"
```

Transitions are enforced in `issueStore.ts`:

- `get_next_issue` only considers issues with `status === "created"`. Accepts an optional `classification` filter.
- `complete_issue` rejects issues already in `"closed"` or `"rejected"`.
- `get_next_review_item` only considers issues with `status === "completed"`.
- `return_issue` rejects issues already in `"closed"` or `"rejected"`.
- `close_issue` rejects issues already in `"closed"` or `"rejected"`.
- There is no transition from a closed state back to open; closed is terminal.

---

## MCP Tools

The server is registered as `agent-issue-tracker` version `1.0.0`. All seven tools follow the same pattern: validate inputs with Zod, call the corresponding `issueStore` function, catch errors and return them as `{ isError: true }` so the calling agent receives a readable message rather than a protocol fault.

### `add_issue`

| Parameter | Type | Notes |
|---|---|---|
| `title` | string | |
| `description` | string | |
| `classification` | `"bug" \| "improvement" \| "feature"` | |
| `agent` | string | Recorded in history |

Returns: confirmation text with the new issue ID and timestamp.

### `list_issues`

| Parameter | Type | Notes |
|---|---|---|
| `status` | `"created" \| "in_progress" \| "completed" \| "in_review" \| "closed" \| "rejected"` (optional) | Filter by lifecycle state |
| `classification` | `"bug" \| "improvement" \| "feature"` (optional) | Filter by issue type |

Read-only query. Does not claim or modify any issues — no history entry is appended. Returns a JSON object with `count` (number of matches) and `issues` (array of summaries containing `id`, `title`, `classification`, `status`, `createdAt`). Both parameters are optional; omitting both returns all issues. The team-lead agent uses this to check queue sizes before deciding which subagent to spawn.

### `get_next_issue`

| Parameter | Type | Notes |
|---|---|---|
| `agent` | string | Recorded in history |
| `classification` | `"bug" \| "improvement" \| "feature"` (optional) | Filter candidates by type |

Selects the oldest `"created"` issue (FIFO — insertion-order, first candidate by array index). When `classification` is provided, only issues of that type are considered. Sets it to `"in_progress"`. Returns the full issue as a JSON string, or a plain-text message if the queue is empty.

### `return_issue`

| Parameter | Type | Notes |
|---|---|---|
| `issue_id` | UUID string | Must exist and not be closed |
| `comment` | string | Appended to `comments[]` |
| `agent` | string | Recorded in history |

Returns the issue to `"created"` status. Intended for cases where an agent cannot complete the work — the comment should explain why.

### `complete_issue`

| Parameter | Type | Notes |
|---|---|---|
| `issue_id` | UUID string | Must exist and not be in a terminal state |
| `comment` | string | Appended to `comments[]` |
| `agent` | string | Recorded in history |

Marks an issue as `"completed"` — ready for code review. The developer agent calls this after finishing work, instead of closing the issue directly.

### `get_next_review_item`

| Parameter | Type | Notes |
|---|---|---|
| `agent` | string | Recorded in history |

Selects the oldest `"completed"` issue (FIFO). Sets it to `"in_review"`. Returns the full issue as a JSON string, or a plain-text message if no issues are ready for review. The code-reviewer agent uses this to pick up work.

### `close_issue`

| Parameter | Type | Notes |
|---|---|---|
| `issue_id` | UUID string | Must exist and not already be closed |
| `resolution` | `"closed" \| "rejected"` | |
| `comment` | string | Appended to `comments[]` |
| `agent` | string | Recorded in history |

Terminal operation. Sets status to `resolution`. Cannot be undone via the API. In the review workflow, the code-reviewer agent calls this after reviewing an `"in_review"` issue.

---

## Storage

Issues are persisted to a single JSON file with shape `{ "issues": [...] }`.

**Load**: synchronous (`fs.readFileSync`) at module initialisation time in `issueStore.ts`. If the file does not exist an empty store is used; a missing file is not an error.

**Save**: after every mutation, `saveIssues()` writes to `<path>.tmp` then renames it over the target file. The rename is atomic on most operating systems, meaning a crash during a write leaves the previous file intact rather than producing a partially-written one.

**Concurrency**: the server is single-process and Node.js executes one event-loop tick at a time, so there are no write-write races between tool calls within this process. There is no protection against two separate processes writing to the same file simultaneously.

**Path**: defaults to `issues.json` in the process working directory. Override with the `ISSUES_FILE` environment variable.

---

## Web Server

A single Express application serves two routes:

- `GET /` — renders an HTML page listing all issues. Accepts an optional `?status=` query parameter (`created`, `in_progress`, `completed`, `in_review`, `closed`, `rejected`) to filter the table. The page includes a `<meta http-equiv="refresh" content="30">` tag for automatic polling.
- `GET /health` — returns `{ "status": "ok", "issueCount": N }` for monitoring.

The HTML is rendered as a template literal inside `webServer.ts`; there are no static asset files or external templating dependencies. All user-supplied strings are HTML-escaped before insertion.

**Port**: defaults to `3000`. Override with the `PORT` environment variable.

---

## stdio and Logging

The MCP protocol uses the process's stdout as its JSON-RPC transport. Any bytes written to stdout that are not valid MCP protocol frames will break the connection. For this reason, all diagnostic output — including Express startup messages — is written to **stderr** via `console.error`. Nothing in the codebase calls `console.log`.

---

## Agent Architecture

The `artifacts/agents/` directory contains prompt files for four agents. Each file uses YAML front-matter (`name`, `description`, `tools`, `mcp`) followed by markdown instructions.

```
                        ┌──────────────┐
                        │  team-lead   │
                        │  (dispatcher)│
                        └──────┬───────┘
               list_issues     │     spawns via Task tool
          ┌────────────────────┼─────────────────────┐
          │                    │                      │
          ▼                    ▼                      ▼
  ┌───────────────┐  ┌────────────────┐  ┌────────────────────┐
  │  code-reviewer │  │   bug-fixer    │  │     developer      │
  │  (reviews)     │  │   (bugs only)  │  │ (improvements +    │
  │                │  │                │  │  features)          │
  └───────────────┘  └────────────────┘  └────────────────────┘
```

**team-lead** — Coordination agent. Runs a continuous loop checking queues via `list_issues` (read-only) in priority order: completed issues (→ code-reviewer), bugs (→ bug-fixer), improvements (→ developer), features (→ developer). Spawns one subagent at a time using the Task tool, passing the full content of the worker's prompt file. Never claims issues itself.

**code-reviewer** — Picks up completed issues via `get_next_review_item`. Reviews changes in a git worktree, runs build and tests, files new issues for findings via `add_issue`, then closes, rejects, or returns the original issue. Merges approved branches to main.

**bug-fixer** — Claims bugs via `get_next_issue(classification: "bug")`. Investigates and fixes in a git worktree. Includes a retry guard that rejects issues returned 3+ times.

**developer** — Claims issues in priority order (bugs → improvements → features) via `get_next_issue`. Implements in a git worktree, commits, and calls `complete_issue` so work enters the review queue. Same retry guard as bug-fixer.

All agents coordinate exclusively through the issue tracker — no direct inter-agent communication. The issue queue acts as a work-stealing task scheduler.

---

## Key Design Decisions

**Single process for both servers.** Running both the MCP stdio server and the Express web server in the same Node.js process simplifies deployment and keeps state shared automatically. The trade-off is that a crash takes down both interfaces.

**Module-level singleton store.** `issueStore.ts` exports plain functions that close over a module-level `let store` variable. This avoids dependency injection or a class instance while remaining straightforward to reason about. It also means the store is initialised exactly once per process, at module load time.

**No database.** A JSON file is sufficient for a prototype coordinating a small number of agents. The entire dataset is held in memory and rewritten on every mutation. This would not scale to large volumes but keeps the deployment footprint to zero external dependencies.

**Errors surfaced as MCP tool results.** Rather than letting exceptions propagate and potentially crashing the stdio transport, every tool handler catches errors and returns them as `{ isError: true, content: [{ type: "text", text: "Error: ..." }] }`. The calling agent sees a legible error message and can decide how to proceed.

**No authentication.** Agents supply their own name in the `agent` field. The server records whatever string is provided. This is intentional for a collaborative prototype — enforcement would require a shared secret or token mechanism that adds complexity without meaningful benefit in a trusted multi-agent environment.

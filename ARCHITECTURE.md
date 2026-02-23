# Architecture

AgentIssueTracker is a single Node.js process that exposes two interfaces simultaneously:

- An **MCP server** over stdio, giving AI agents four tools to manage issues.
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
     │  4 tool definitions  │ │  GET /  (HTML table) │
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
                 │  getNextIssue         │
                 │  returnIssue          │
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

`return_issue` and `close_issue` both append a `{ timestamp, agent, text }` comment. Comments are separate from history entries: history records *what happened*, comments record *why*.

---

## Issue Lifecycle

```
          add_issue
              │
              ▼
          "created"  ◄──────────── return_issue (with comment)
              │
              │  get_next_issue
              ▼
          "in_progress"
              │
        close_issue
       ┌──────┴──────┐
       ▼             ▼
  "completed"   "rejected"
```

Transitions are enforced in `issueStore.ts`:

- `get_next_issue` only considers issues with `status === "created"`.
- `return_issue` rejects issues already in `"completed"` or `"rejected"`.
- `close_issue` rejects issues already in `"completed"` or `"rejected"`.
- There is no transition from a closed state back to open; closed is terminal.

---

## MCP Tools

The server is registered as `agent-issue-tracker` version `1.0.0`. All four tools follow the same pattern: validate inputs with Zod, call the corresponding `issueStore` function, catch errors and return them as `{ isError: true }` so the calling agent receives a readable message rather than a protocol fault.

### `add_issue`

| Parameter | Type | Notes |
|---|---|---|
| `title` | string | |
| `description` | string | |
| `classification` | `"bug" \| "improvement" \| "feature"` | |
| `agent` | string | Recorded in history |

Returns: confirmation text with the new issue ID and timestamp.

### `get_next_issue`

| Parameter | Type | Notes |
|---|---|---|
| `agent` | string | Recorded in history |

Selects the oldest `"created"` issue (FIFO — insertion-order, first candidate by array index). Sets it to `"in_progress"`. Returns the full issue as a JSON string, or a plain-text message if the queue is empty.

### `return_issue`

| Parameter | Type | Notes |
|---|---|---|
| `issue_id` | UUID string | Must exist and not be closed |
| `comment` | string | Appended to `comments[]` |
| `agent` | string | Recorded in history |

Returns the issue to `"created"` status. Intended for cases where an agent cannot complete the work — the comment should explain why.

### `close_issue`

| Parameter | Type | Notes |
|---|---|---|
| `issue_id` | UUID string | Must exist and not already be closed |
| `resolution` | `"completed" \| "rejected"` | |
| `comment` | string | Appended to `comments[]` |
| `agent` | string | Recorded in history |

Terminal operation. Sets status to `resolution`. Cannot be undone via the API.

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

- `GET /` — renders an HTML page listing all issues. Accepts an optional `?status=` query parameter (`created`, `in_progress`, `completed`, `rejected`) to filter the table. The page includes a `<meta http-equiv="refresh" content="30">` tag for automatic polling.
- `GET /health` — returns `{ "status": "ok", "issueCount": N }` for monitoring.

The HTML is rendered as a template literal inside `webServer.ts`; there are no static asset files or external templating dependencies. All user-supplied strings are HTML-escaped before insertion.

**Port**: defaults to `3000`. Override with the `PORT` environment variable.

---

## stdio and Logging

The MCP protocol uses the process's stdout as its JSON-RPC transport. Any bytes written to stdout that are not valid MCP protocol frames will break the connection. For this reason, all diagnostic output — including Express startup messages — is written to **stderr** via `console.error`. Nothing in the codebase calls `console.log`.

---

## Key Design Decisions

**Single process for both servers.** Running both the MCP stdio server and the Express web server in the same Node.js process simplifies deployment and keeps state shared automatically. The trade-off is that a crash takes down both interfaces.

**Module-level singleton store.** `issueStore.ts` exports plain functions that close over a module-level `let store` variable. This avoids dependency injection or a class instance while remaining straightforward to reason about. It also means the store is initialised exactly once per process, at module load time.

**No database.** A JSON file is sufficient for a prototype coordinating a small number of agents. The entire dataset is held in memory and rewritten on every mutation. This would not scale to large volumes but keeps the deployment footprint to zero external dependencies.

**Errors surfaced as MCP tool results.** Rather than letting exceptions propagate and potentially crashing the stdio transport, every tool handler catches errors and returns them as `{ isError: true, content: [{ type: "text", text: "Error: ..." }] }`. The calling agent sees a legible error message and can decide how to proceed.

**No authentication.** Agents supply their own name in the `agent` field. The server records whatever string is provided. This is intentional for a collaborative prototype — enforcement would require a shared secret or token mechanism that adds complexity without meaningful benefit in a trusted multi-agent environment.

# AgentIssueTracker — Agent Context

This is an MCP server that lets AI agents track and coordinate work on shared issues. It exposes four MCP tools over stdio and a read-only web UI over HTTP. Both run in the same Node.js process.

## Commands

```bash
npm run dev          # Run directly with tsx (no build step, recommended for development)
npm run dev:watch    # Same, with auto-restart on file changes
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (requires build first)
npm test             # Run unit tests (vitest, single pass)
npm run test:watch   # Run tests in watch mode
```

## File Map

```
src/types.ts            Shared interfaces — Issue, HistoryEntry, Comment, IssueStore
src/storage.ts          JSON file persistence — loadIssues() and saveIssues()
src/issueStore.ts       Business logic — in-memory store + all four CRUD operations
src/mcpServer.ts        MCP tool registrations — delegates to issueStore
src/webServer.ts        Express web UI — HTML table with ?status= filter
src/index.ts            Entry point — starts web server, then connects MCP stdio transport
src/storage.test.ts     Tests for loadIssues() and saveIssues()
src/issueStore.test.ts  Tests for all four CRUD operations
src/webServer.test.ts   Tests for HTTP routes and HTML rendering
vitest.config.ts        Vitest configuration
```

Runtime artefacts (not in source control):
```
issues.json        Live data store, auto-created on first write
dist/              Compiled JavaScript, produced by npm run build
```

## Issue Status Lifecycle

```
"created"  →  "in_progress"  →  "closed"
                    │          →  "rejected"
                    │
                    └──(return_issue)──→  "created"
```

Closed states (`closed`, `rejected`) are terminal — no tool transitions out of them.

## MCP Tools

| Tool | Key inputs | What it does |
|---|---|---|
| `add_issue` | title, description, classification, agent | Creates issue with status `created` |
| `get_next_issue` | agent | Takes oldest `created` issue (FIFO), sets it `in_progress`, returns full JSON |
| `return_issue` | issue_id, comment, agent | Puts issue back to `created`; appends comment |
| `close_issue` | issue_id, resolution, comment, agent | Sets `closed` or `rejected`; appends comment |

All tools append to the issue's `history[]` array (timestamp + agent + action description).

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port for the web UI |
| `ISSUES_FILE` | `<cwd>/issues.json` | Path to the JSON data file |

## Critical Conventions

**Never use `console.log`.** stdout is the MCP JSON-RPC transport. Any non-protocol bytes written there corrupt the connection. Use `console.error` for all diagnostic output.

**All mutations go through `issueStore.ts`.** The web server is read-only; it calls only `getAllIssues()` and `getIssuesByStatus()`. Never add write paths to `webServer.ts`.

**Atomic saves.** `saveIssues()` in `storage.ts` writes to `issues.json.tmp` then renames it. Do not replace this with a direct `writeFile` to `issues.json` — the rename is what prevents corruption on crash.

**Module resolution requires `.js` extensions.** The project uses `"module": "NodeNext"` in tsconfig. All internal imports must end in `.js` even though the source files are `.ts`. The MCP SDK also ships as native ESM and requires this setting.

**`issueStore.ts` is a singleton.** The store is loaded once at module initialisation (`let store = loadIssues()`). Do not call `loadIssues()` again elsewhere — it reads from disk and would overwrite in-memory state.

**Test isolation for the singleton.** Because the store is module-level state, tests use `vi.doMock('./storage.js', ...)` + `vi.resetModules()` in `beforeEach` to get a fresh module (and therefore a fresh empty store) for each test. Do not add a `resetStore()` export to production code — the test pattern already handles this cleanly.

## MCP Client Configuration

For Claude Desktop, add to `%APPDATA%\Claude\claude_desktop_config.json`:

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

For development without a build step:

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "npx",
      "args": ["tsx", "C:\\Source\\Prototypes\\AgentIssueTracker\\src\\index.ts"]
    }
  }
}
```

Restart Claude Desktop after editing the config.

## Extending This Server

**Adding a new tool**: add a `server.tool(...)` call in `src/mcpServer.ts` following the existing pattern, implement the business logic in `src/issueStore.ts`, and rebuild.

**Adding a new issue field**: add it to the `Issue` interface in `src/types.ts`, populate it in `addIssue()` in `issueStore.ts`, and add a column to `renderIssueRow()` in `webServer.ts`. Existing `issues.json` data will be missing the field — handle that with an optional (`?`) type or a default value when reading.

**Switching to a database**: replace `src/storage.ts` with a new persistence module that implements the same `loadIssues()` / `saveIssues()` signatures. `issueStore.ts` imports only those two functions and will require no changes.

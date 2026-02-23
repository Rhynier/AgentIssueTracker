import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcpServer.js";
import { startWebServer } from "./webServer.js";
import { DATA_FILE } from "./storage.js";

const WEB_PORT = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : 3000;

async function main(): Promise<void> {
  // Log to stderr only — stdout is reserved for MCP JSON-RPC
  console.error(`[Startup] Data file: ${DATA_FILE}`);
  console.error(`[Startup] Starting web server on port ${WEB_PORT}...`);

  startWebServer(WEB_PORT);

  console.error(`[Startup] Starting MCP server over stdio...`);
  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error(`[Startup] MCP server connected. Ready.`);
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});

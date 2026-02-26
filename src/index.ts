import express from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcpServer.js";
import { createWebServer } from "./webServer.js";
import { DATA_FILE } from "./storage.js";

const PORT = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : 3000;

const transports = new Map<string, StreamableHTTPServerTransport>();

async function main(): Promise<void> {
  const app = createWebServer();
  app.use(express.json());

  // New or existing session
  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res, req.body);
        return;
      }

      if (sessionId) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Brand new session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          transports.set(newId, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[MCP] POST error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  // SSE stream for server-initiated messages
  app.get("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
    } catch (err) {
      console.error("[MCP] GET error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  // Session termination
  app.delete("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
    } catch (err) {
      console.error("[MCP] DELETE error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  app.listen(PORT, () => {
    console.error(`[Startup] Data file: ${DATA_FILE}`);
    console.error(`[Startup] Web UI:       http://localhost:${PORT}/`);
    console.error(`[Startup] MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});

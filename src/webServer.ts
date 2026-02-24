import express, { type Request, type Response } from "express";
import { getAllIssues, getIssuesByStatus } from "./issueStore.js";
import type { Issue, IssueStatus } from "./types.js";

const VALID_STATUSES: IssueStatus[] = [
  "created",
  "in_progress",
  "completed",
  "in_review",
  "closed",
  "rejected",
];

const STATUS_COLORS: Record<IssueStatus, string> = {
  created: "#6c757d",
  in_progress: "#0d6efd",
  completed: "#6f42c1",
  in_review: "#fd7e14",
  closed: "#198754",
  rejected: "#dc3545",
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  bug: "#dc3545",
  improvement: "#fd7e14",
  feature: "#0dcaf0",
};

function badge(text: string, color: string): string {
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.8em;white-space:nowrap">${text}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function renderIssueRow(issue: Issue): string {
  const latestHistory =
    issue.history.length > 0 ? issue.history[issue.history.length - 1] : null;

  const commentsHtml =
    issue.comments.length === 0
      ? "<em style='color:#aaa'>none</em>"
      : issue.comments
          .map(
            (c) =>
              `<div style="font-size:0.85em;border-left:2px solid #ddd;padding-left:6px;margin-bottom:4px">
                <strong>${escapeHtml(c.agent)}</strong> @ ${formatDate(c.timestamp)}<br>
                ${escapeHtml(c.text)}
               </div>`
          )
          .join("");

  return `
    <tr>
      <td style="font-family:monospace;font-size:0.8em;max-width:120px;word-break:break-all">${escapeHtml(issue.id)}</td>
      <td><strong>${escapeHtml(issue.title)}</strong><br>
          <span style="color:#555;font-size:0.85em">${escapeHtml(issue.description)}</span>
      </td>
      <td>${badge(issue.classification, CLASSIFICATION_COLORS[issue.classification] ?? "#888")}</td>
      <td>${badge(issue.status.replace("_", " "), STATUS_COLORS[issue.status])}</td>
      <td style="font-size:0.85em">${formatDate(issue.createdAt)}</td>
      <td style="font-size:0.85em">${formatDate(issue.modifiedAt)}</td>
      <td style="font-size:0.85em">
        ${latestHistory ? `<strong>${escapeHtml(latestHistory.agent)}</strong>: ${escapeHtml(latestHistory.action)}` : ""}
        <br><em style="color:#aaa">(${issue.history.length} entries)</em>
      </td>
      <td style="font-size:0.85em">${commentsHtml}</td>
    </tr>`;
}

function renderPage(issues: Issue[], currentStatus: string): string {
  const filterLinks = (["all", ...VALID_STATUSES] as string[])
    .map((s) => {
      const active = s === currentStatus;
      return `<a href="?status=${s}" style="
        margin-right:8px;
        padding:4px 12px;
        border-radius:4px;
        text-decoration:none;
        background:${active ? "#0d6efd" : "#e9ecef"};
        color:${active ? "#fff" : "#333"};
        font-size:0.9em">${s.replace("_", " ")}</a>`;
    })
    .join("");

  const rows =
    issues.length === 0
      ? `<tr><td colspan="8" style="text-align:center;padding:20px;color:#aaa">No issues found.</td></tr>`
      : issues.map(renderIssueRow).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Issue Tracker</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #f8f9fa; }
    h1 { margin-bottom: 4px; color: #212529; }
    .subtitle { color: #6c757d; font-size: 0.9em; margin-bottom: 20px; }
    .filters { margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
    th { background: #343a40; color: #fff; padding: 10px 12px; text-align: left; font-size: 0.85em; }
    td { padding: 10px 12px; border-bottom: 1px solid #dee2e6; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f1f3f5; }
    .refresh { float: right; font-size: 0.85em; color: #6c757d; }
  </style>
  <meta http-equiv="refresh" content="30">
</head>
<body>
  <h1>Agent Issue Tracker <span class="refresh">Auto-refreshes every 30s</span></h1>
  <p class="subtitle">Showing ${issues.length} issue(s) &mdash; Filter: <strong>${escapeHtml(currentStatus)}</strong></p>
  <div class="filters">${filterLinks}</div>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Title / Description</th><th>Type</th><th>Status</th>
        <th>Created</th><th>Modified</th><th>Last Activity</th><th>Comments</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

export function createWebServer(): express.Application {
  const app = express();

  app.get("/", (req: Request, res: Response) => {
    const rawStatus = req.query["status"] as string | undefined;
    const statusFilter =
      rawStatus && VALID_STATUSES.includes(rawStatus as IssueStatus)
        ? (rawStatus as IssueStatus)
        : undefined;

    const issues = statusFilter
      ? getIssuesByStatus(statusFilter)
      : getAllIssues();

    const currentFilter = statusFilter ?? "all";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderPage(issues, currentFilter));
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", issueCount: getAllIssues().length });
  });

  return app;
}

export function startWebServer(port: number): void {
  const app = createWebServer();
  app.listen(port, () => {
    // Use stderr — stdout is reserved for MCP JSON-RPC
    console.error(`[WebServer] Listening on http://localhost:${port}`);
  });
}

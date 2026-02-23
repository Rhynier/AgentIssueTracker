import * as fs from "fs";
import * as path from "path";
import type { IssueStore } from "./types.js";

export const DATA_FILE = process.env["ISSUES_FILE"]
  ? path.resolve(process.env["ISSUES_FILE"])
  : path.resolve(process.cwd(), "issues.json");

/**
 * Load issues synchronously at startup.
 * Returns an empty store if the file does not exist yet.
 */
export function loadIssues(): IssueStore {
  if (!fs.existsSync(DATA_FILE)) {
    return { issues: [] };
  }
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw) as IssueStore;
}

/**
 * Persist the full store to disk asynchronously.
 * Writes to a .tmp file first, then renames atomically to avoid
 * partial writes corrupting the store on crash.
 */
export async function saveIssues(store: IssueStore): Promise<void> {
  const tmp = DATA_FILE + ".tmp";
  const json = JSON.stringify(store, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");
  await fs.promises.rename(tmp, DATA_FILE);
}

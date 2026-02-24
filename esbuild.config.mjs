import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/agent-issue-tracker.cjs",
  minify: true,
  sourcemap: true,
  logLevel: "info",
});

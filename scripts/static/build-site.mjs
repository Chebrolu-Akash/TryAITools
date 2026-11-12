#!/usr/bin/env bun
// Builds the complete static site locally, stopping at the first failure:
//   1. bun run build                 (the app)
//   2. build-gate.mjs                (gate.mjs as the Worker entry, run_worker_first for page routes)
//   3. prerender.mjs --snapshot X    (static HTML from a D1 snapshot; validated; swapped in only on success)
//   4. db:check-config               (isolation checks on the generated config)
//
//   bun scripts/static/build-site.mjs --snapshot <export.sql | d1.sqlite>
//
// Nothing remote is contacted and nothing is deployed. A failed step leaves the previous deployment untouched (deploying
// is a separate, explicitly approved step: see docs/static-site.md).
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--snapshot");
const snapshot = i >= 0 ? args[i + 1] : undefined;
if (!snapshot) {
  console.error("Usage: bun scripts/static/build-site.mjs --snapshot <export.sql | d1.sqlite>");
  process.exit(2);
}
const node = process.platform === "win32" ? "node.exe" : "node";
const steps = [
  ["build the app", "bun", ["run", "build"]],
  ["bundle the gate", "bun", ["scripts/static/build-gate.mjs"]],
  ["pre-render pages", node, ["scripts/static/prerender.mjs", "--snapshot", snapshot]],
  ["check the generated config", "bun", ["scripts/db/check-generated-config.mjs"]],
];
for (const [label, cmd, cmdArgs] of steps) {
  console.log(`\n== ${label}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (r.error || r.status !== 0) {
    console.error(
      `\nSTOPPED: "${label}" failed${r.error ? ` (${r.error.message})` : ""}. Nothing was deployed.`,
    );
    process.exit(1);
  }
}
console.log("\nStatic site ready in .output (not deployed).");

#!/usr/bin/env bun
// The build command for Cloudflare Workers Builds (and for any release): produces the same static architecture as the
// hand-made releases, or fails. Steps, stopping at the first failure:
//   1. a read-only D1 snapshot (`wrangler d1 export --remote`) of the target database, unless one is given
//   2. scripts/static/build-site.mjs --snapshot   (app build -> gate bundle -> pre-render -> config checks)
//   3. scripts/static/verify-static-output.mjs    (the Worker entry is the gate and the pages are pre-rendered)
//
//   bun scripts/static/ci-build.mjs                       in Workers Builds: main -> production, other branches -> preview
//   STATIC_TARGET=preview bun scripts/static/ci-build.mjs  locally the target must be named
//   bun scripts/static/ci-build.mjs --snapshot <export.sql | d1.sqlite>   use an existing snapshot (no D1 read)
//
// Never deploys and never writes to D1. The exported snapshot is deleted afterwards.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TARGETS = {
  production: { db: "tryaitools-production", config: "wrangler.production-migrations.jsonc" },
  preview: { db: "tryaitools-preview", config: "wrangler.preview-migrations.jsonc" },
};
const die = (msg) => {
  console.error(`\nSTATIC BUILD STOPPED: ${msg}\nNothing was built for deployment.`);
  process.exit(1);
};

/** Which database a build is for. In Workers Builds only the production branch may use production data. */
export function resolveTarget(env) {
  if (env.STATIC_TARGET) {
    if (!TARGETS[env.STATIC_TARGET])
      return { error: `STATIC_TARGET must be production or preview` };
    if (env.WORKERS_CI && env.STATIC_TARGET === "production" && env.WORKERS_CI_BRANCH !== "main")
      return {
        error: `production data may only be built from main (branch: ${env.WORKERS_CI_BRANCH})`,
      };
    return { target: env.STATIC_TARGET };
  }
  if (env.WORKERS_CI) {
    if (!env.WORKERS_CI_BRANCH) return { error: "WORKERS_CI_BRANCH is not set" };
    return { target: env.WORKERS_CI_BRANCH === "main" ? "production" : "preview" };
  }
  return { error: "set STATIC_TARGET=production|preview (or pass --snapshot)" };
}

if (import.meta.main) {
  // The pre-render runs under Node (node:sqlite), not Bun: check that Node.
  const nodeV = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "";
  const [nm, nn] = nodeV.replace(/^v/, "").split(".").map(Number);
  if (!(nm > 22 || (nm === 22 && nn >= 5)))
    die(`Node >= 22.5 is required for the pre-render (found "${nodeV || "none"}")`);

  const args = process.argv.slice(2);
  const si = args.indexOf("--snapshot");
  let snapshot = si >= 0 ? args[si + 1] : process.env.STATIC_SNAPSHOT;
  let tmp = null;
  if (snapshot) {
    if (!existsSync(snapshot)) die(`snapshot not found: ${snapshot}`);
    console.log(`== snapshot: ${snapshot} (given)`);
  } else {
    const { target, error } = resolveTarget(process.env);
    if (error) die(error);
    const { db, config } = TARGETS[target];
    tmp = mkdtempSync(join(tmpdir(), "tryaitools-snapshot-"));
    snapshot = join(tmp, `${db}.sql`);
    console.log(`== snapshot: read-only export of ${db} (target: ${target})`);
    const r = spawnSync(
      "node",
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "export",
        db,
        "--remote",
        "--config",
        config,
        "--output",
        snapshot,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0 || !existsSync(snapshot) || statSync(snapshot).size < 1000)
      die(`could not export ${db} (check the build token can read D1)`);
  }
  try {
    for (const [label, cmd, cmdArgs] of [
      ["static build", "bun", ["scripts/static/build-site.mjs", "--snapshot", snapshot]],
      ["verify static output", "node", ["scripts/static/verify-static-output.mjs"]],
    ]) {
      console.log(`\n== ${label}`);
      const r = spawnSync(cmd, cmdArgs, {
        stdio: "inherit",
        env: { ...process.env, STATIC_PIPELINE: "1" },
      });
      if (r.error || r.status !== 0) die(`"${label}" failed`);
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  console.log("\nSTATIC BUILD READY: .output holds the gate Worker and the pre-rendered site.");
}

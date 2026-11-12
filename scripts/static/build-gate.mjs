#!/usr/bin/env bun
// Bundles the static-site gate (src/static/entry.ts) into .output/server/gate.mjs and makes it the Worker entry in the
// generated config (.output/server/wrangler.json): the Worker runs first for page routes only, while scripts, styles and
// images keep being served straight from static assets. Run after `bun run build`. Local files only.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Exclusions name the build's own root files (icons, robots.txt, the manifest) exactly. A wildcard such as "!/*.png" would
// also match /media/<id>.png, and the uploaded images must reach the gate (it reads them from R2).
const ROOT_FILE = /\.(png|ico|svg|jpe?g|webp|gif|webmanifest|txt)$/;
export const runWorkerFirst = (rootFiles) => [
  "/*",
  "!/assets/*",
  ...rootFiles
    .filter((f) => ROOT_FILE.test(f))
    .sort()
    .map((f) => `!/${f}`),
];

const server = resolve(".output/server");
const configPath = resolve(server, "wrangler.json");
if (!existsSync(configPath)) {
  console.error("No build output. Run: bun run build");
  process.exit(2);
}
const result = await Bun.build({
  entrypoints: [resolve("src/static/entry.ts")],
  outdir: server,
  naming: "gate.mjs",
  target: "browser",
  format: "esm",
  minify: true,
  external: ["__nitro_entry__", "__news_cron__"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// The AI News cron module (src/lib/news/cron.ts) as its own file: the gate imports it only when
// a Cron Trigger fires, so page requests never load it. Also usable as the entry of a dedicated cron Worker.
const cron = await Bun.build({
  entrypoints: [resolve("src/lib/news/cron.ts")],
  outdir: server,
  naming: "news-cron.mjs",
  target: "browser",
  format: "esm",
  minify: true,
});
if (!cron.success) {
  for (const log of cron.logs) console.error(log);
  process.exit(1);
}
const gatePath = resolve(server, "gate.mjs");
const code = readFileSync(gatePath, "utf8");
if (!code.includes("__nitro_entry__") || !code.includes("__news_cron__")) {
  console.error("gate.mjs does not import the app entry / news cron placeholders; refusing.");
  process.exit(1);
}
writeFileSync(
  gatePath,
  code
    .replaceAll('"__nitro_entry__"', '"./index.mjs"')
    .replaceAll('"__news_cron__"', '"./news-cron.mjs"'),
);
const size = code.length;
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.name !== "pixel-perfect") {
  console.error(`Unexpected Worker name "${config.name}"; refusing.`);
  process.exit(2);
}
config.main = "gate.mjs";
const publicDir = resolve(".output/public");
const rootFiles = readdirSync(publicDir, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name);
config.assets = { ...config.assets, run_worker_first: runWorkerFirst(rootFiles) };
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(
  `gate.mjs: ${(size / 1024).toFixed(1)} KB; wrangler.json main=gate.mjs, run_worker_first set for page routes`,
);

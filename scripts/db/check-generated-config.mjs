#!/usr/bin/env bun
// Run AFTER `bun run build`. Checks the committed config for production isolation AND whether the Nitro-generated
// Worker config (.output/server/wrangler.json, the file Wrangler really uses) kept the previews D1 binding.
//   bun scripts/db/check-generated-config.mjs
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MIGRATIONS_CONFIG_FILE,
  PRODUCTION_DB_NAME,
  PRODUCTION_MIGRATIONS_CONFIG_FILE,
  parseJsonc,
  validateGeneratedConfig,
  validateRepoConfig,
} from "./wrangler-config.mjs";

let ok = true;
const show = (title, rows) => {
  console.log(`\n${title}`);
  for (const r of rows) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
    ok &&= r.ok;
  }
};
const read = (f) => (existsSync(resolve(f)) ? parseJsonc(readFileSync(resolve(f), "utf8")) : null);

const cfg = read("wrangler.jsonc");
const mig = read(MIGRATIONS_CONFIG_FILE);
if (!cfg || !mig) {
  console.error(
    `Missing wrangler.jsonc or ${MIGRATIONS_CONFIG_FILE}. Run: bun scripts/db/set-preview-binding.mjs <database_id> --write`,
  );
  process.exit(1);
}
const prodMig = read(PRODUCTION_MIGRATIONS_CONFIG_FILE);
show("Committed configuration", validateRepoConfig(cfg, mig, prodMig));
const gen = read(".output/server/wrangler.json");
if (!gen) {
  console.log("\nGenerated config not found (run `bun run build` first).");
  process.exit(1);
}
show("Nitro-generated configuration", validateGeneratedConfig(gen, cfg));

// The AI News cron Workers (docs/ai-news.md): each its own Worker, bound only to its environment's database, no public
// URL, fixed schedule, Gemini 3.5 Flash Lite, no key in the file.
//   preview:    wrangler.news-cron.jsonc            -> tryaitools-news-cron-preview -> tryaitools-preview
//   production: wrangler.news-cron.production.jsonc -> tryaitools-news-cron         -> tryaitools-production
const previewDb = mig.d1_databases?.[0];
const prodDb = prodMig?.d1_databases?.[0];
const cronRows = (cron, want) => {
  const d1 = cron.d1_databases ?? [];
  return [
    {
      name: `separate Worker named ${want.name}`,
      ok: cron.name === want.name && cron.name !== cfg.name,
      detail: cron.name,
    },
    {
      name: `only binding is the ${want.label} database as DB`,
      ok:
        !!want.db &&
        d1.length === 1 &&
        d1[0].binding === "DB" &&
        d1[0].database_id === want.db.database_id &&
        d1[0].database_name === want.db.database_name,
      detail: d1.map((d) => `${d.binding}=${d.database_name}`).join(", "),
    },
    {
      name: "no other bindings (R2, KV, services, queues)",
      ok: !["r2_buckets", "kv_namespaces", "services", "queues", "durable_objects"].some(
        (k) => k in cron,
      ),
    },
    {
      name: "no public URL (workers_dev and preview_urls off, no routes)",
      ok: cron.workers_dev === false && cron.preview_urls === false && !cron.routes && !cron.route,
    },
    {
      name: "schedule is every 3 hours",
      ok: JSON.stringify(cron.triggers?.crons) === JSON.stringify(["0 */3 * * *"]),
      detail: JSON.stringify(cron.triggers?.crons),
    },
    {
      name: "model is gemini-3.5-flash-lite",
      ok: cron.vars?.NEWS_MODEL === "gemini-3.5-flash-lite",
      detail: cron.vars?.NEWS_MODEL,
    },
    { name: "Workers Logs off", ok: cron.observability?.enabled === false },
    { name: "no API key in the file", ok: !/API_KEY/.test(JSON.stringify(cron)) },
  ];
};
const previewCron = read("wrangler.news-cron.jsonc");
if (previewCron)
  show(
    "AI News cron Worker, preview (wrangler.news-cron.jsonc)",
    cronRows(previewCron, { name: "tryaitools-news-cron-preview", db: previewDb, label: "preview" }),
  );
const prodCron = read("wrangler.news-cron.production.jsonc");
if (prodCron)
  show("AI News cron Worker, production (wrangler.news-cron.production.jsonc)", [
    ...cronRows(prodCron, { name: "tryaitools-news-cron", db: prodDb, label: "production" }),
    {
      name: `production database is ${PRODUCTION_DB_NAME}, never the preview one`,
      ok:
        prodDb?.database_name === PRODUCTION_DB_NAME &&
        (prodCron.d1_databases ?? []).every((d) => d.database_id !== previewDb?.database_id),
    },
  ]);
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
// Writes the PREVIEW D1 binding into wrangler.jsonc (local edit; review the diff before committing).
//   node scripts/db/set-preview-binding.mjs <database_id> [database_name=tryaitools-preview]
// database_id is the UUID printed by `wrangler d1 create tryaitools-preview`. It is an identifier, not a secret.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { UUID, assertPreviewDb } from "./guard.mjs";

const [id, name = "tryaitools-preview"] = process.argv.slice(2);
assertPreviewDb(name);
if (!id || !UUID.test(id)) {
  console.error("Usage: node scripts/db/set-preview-binding.mjs <database_id (UUID)> [tryaitools-preview]");
  process.exit(2);
}
const file = resolve("wrangler.jsonc");
const cfg = JSON.parse(readFileSync(file, "utf8"));
if (cfg.name !== "pixel-perfect") {
  console.error(`Refusing: wrangler.jsonc name is "${cfg.name}", expected "pixel-perfect". Not touching it.`);
  process.exit(2);
}
cfg.d1_databases = [{ binding: "DB", database_name: name, database_id: id, migrations_dir: "migrations" }];
writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(`wrangler.jsonc updated: binding DB -> ${name} (${id}). Review with: git diff wrangler.jsonc`);

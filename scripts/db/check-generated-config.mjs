#!/usr/bin/env bun
// Run AFTER `bun run build`. Checks the committed config for production isolation AND whether the Nitro-generated
// Worker config (.output/server/wrangler.json, the file Wrangler really uses) kept the previews D1 binding.
//   bun scripts/db/check-generated-config.mjs
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MIGRATIONS_CONFIG_FILE,
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
show("Committed configuration", validateRepoConfig(cfg, mig));
const gen = read(".output/server/wrangler.json");
if (!gen) {
  console.log("\nGenerated config not found (run `bun run build` first).");
  process.exit(1);
}
show("Nitro-generated configuration", validateGeneratedConfig(gen, cfg));
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);

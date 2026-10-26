#!/usr/bin/env node
// Run AFTER `bun run build`. Proves the Nitro-generated Worker config (the file `wrangler deploy` /
// `versions upload` actually uses) contains the intended PREVIEW D1 binding and nothing else of the kind.
//   node scripts/db/check-generated-config.mjs
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PREVIEW_NAME, UUID } from "./guard.mjs";

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const readJsonc = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""));

const src = readJsonc(resolve("wrangler.jsonc"));
const srcDb = src.d1_databases?.find((d) => d.binding === "DB");
check("wrangler.jsonc declares D1 binding DB", !!srcDb);
check("source binding is a preview database", !!srcDb && PREVIEW_NAME.test(srcDb.database_name) && UUID.test(srcDb.database_id), srcDb?.database_name);

const genPath = resolve(".output/server/wrangler.json");
if (!existsSync(genPath)) { check("generated config exists (run `bun run build` first)", false, genPath); process.exit(1); }
const gen = readJsonc(genPath);
const genDb = gen.d1_databases?.filter((d) => d.binding === "DB") ?? [];
check("generated config has exactly one DB binding", genDb.length === 1, JSON.stringify(gen.d1_databases ?? null));
check("generated binding matches wrangler.jsonc (same database_id)", genDb[0]?.database_id === srcDb?.database_id, genDb[0]?.database_name);
check("generated binding is a preview database", !!genDb[0] && PREVIEW_NAME.test(genDb[0].database_name));
check("generated config has no other D1 databases", (gen.d1_databases?.length ?? 0) === 1);
check("Worker name is still pixel-perfect", gen.name === "pixel-perfect", gen.name);
check("no custom domain / routes in generated config", !gen.routes && !gen.route, JSON.stringify(gen.routes ?? gen.route ?? null));
console.log(results.every(Boolean) ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(results.every(Boolean) ? 0 : 1);

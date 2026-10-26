#!/usr/bin/env node
// Applies migrations + the generated import to the PREVIEW D1 database, then verifies row counts.
//   node scripts/db/build-import.mjs --env preview
//   node scripts/db/preview-db.mjs migrate [tryaitools-preview]
//   node scripts/db/preview-db.mjs import  [tryaitools-preview]
//   node scripts/db/preview-db.mjs verify  [tryaitools-preview]
// Always uses --config wrangler.jsonc (never the Nitro-generated config) and --remote against the preview DB only.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPreviewDb } from "./guard.mjs";

const [cmd, nameArg = "tryaitools-preview"] = process.argv.slice(2);
const db = assertPreviewDb(nameArg);
const out = resolve("db/import/out");
const wr = (args) => {
  const r = spawnSync("npx", ["wrangler", ...args, "--config", "wrangler.jsonc"], { encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(r.status ?? 1); }
  return r.stdout;
};
const query = (sql) => JSON.parse(wr(["d1", "execute", db, "--remote", "--json", "--command", sql]))[0].results;

if (cmd === "migrate") {
  console.log(wr(["d1", "migrations", "apply", db, "--remote"]));
} else if (cmd === "import") {
  const report = JSON.parse(readFileSync(resolve(out, "report.json"), "utf8"));
  if (report.env !== "preview") { console.error(`Generated import is for env="${report.env}". Run: node scripts/db/build-import.mjs --env preview`); process.exit(2); }
  for (const f of report.generatedFiles) { console.log(`importing ${f}`); wr(["d1", "execute", db, "--remote", "--yes", "--file", resolve(out, f)]); }
  console.log("done. Now run: node scripts/db/preview-db.mjs verify");
} else if (cmd === "verify") {
  const report = JSON.parse(readFileSync(resolve(out, "report.json"), "utf8"));
  const n = (sql) => Object.values(query(sql)[0])[0];
  const checks = [
    ["environment marker is 'preview'", query("SELECT value FROM meta WHERE key='environment'")[0]?.value === "preview"],
    ["categories", n("SELECT count(*) FROM categories") === report.expected.categories],
    ["tools", n("SELECT count(*) FROM tools") === report.expected.tools],
    ["flagged (draft + needs_review)", n("SELECT count(*) FROM tools WHERE needs_review=1 AND status='draft'") === report.expected.flagged],
    ["published", n("SELECT count(*) FROM tools WHERE status='published'") === report.expected.published],
    ["indexable", n("SELECT count(*) FROM tools WHERE indexing='index'") === report.expected.indexable],
    ["unique slugs", n("SELECT count(DISTINCT slug) FROM tools") === report.expected.tools],
    ["admin_users empty", n("SELECT count(*) FROM admin_users") === 0],
  ];
  checks.forEach(([k, ok]) => console.log(`${ok ? "PASS" : "FAIL"}  ${k}`));
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
} else {
  console.error("Usage: preview-db.mjs migrate|import|verify [database-name]");
  process.exit(2);
}

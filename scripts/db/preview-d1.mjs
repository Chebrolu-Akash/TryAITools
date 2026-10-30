#!/usr/bin/env bun
// Operates on the PREVIEW D1 database only (Bun + bunx; Wrangler >= 4.135). Does not use or edit scripts/db/preview-db.mjs.
//   bun scripts/db/preview-d1.mjs migrate | import | verify | backup | status
//   bun scripts/db/preview-d1.mjs rollback --confirm <database_name>      (newest migration only)
// Target comes from wrangler.preview-migrations.jsonc (binding PREVIEW_DB); it must be a "*-preview" database.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  MIGRATIONS_CONFIG_FILE,
  parseJsonc,
  pickRollback,
  resolveTarget,
  wranglerArgs,
} from "./wrangler-config.mjs";

const [cmd, ...rest] = process.argv.slice(2);
if (!existsSync(MIGRATIONS_CONFIG_FILE)) {
  console.error(
    `Missing ${MIGRATIONS_CONFIG_FILE}. Run: bun scripts/db/set-preview-binding.mjs <database_id> --write`,
  );
  process.exit(2);
}
let target;
try {
  target = resolveTarget(parseJsonc(readFileSync(MIGRATIONS_CONFIG_FILE, "utf8")));
} catch (e) {
  console.error("Refusing:", e.message);
  process.exit(2);
}
console.log(
  `Target: PREVIEW database "${target.database_name}" (remote). Production is not addressed by this script.`,
);

const wr = (args) => {
  const r = spawnSync("bunx", ["wrangler", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
};
const query = (sql) => JSON.parse(wr(wranglerArgs("query", target, { sql })))[0].results;
const out = resolve("db/import/out");
const report = () => JSON.parse(readFileSync(resolve(out, "report.json"), "utf8"));

if (cmd === "status") console.log(wr(wranglerArgs("list", target)));
else if (cmd === "migrate") console.log(wr(wranglerArgs("migrate", target)));
else if (cmd === "backup") {
  const file = `backup-${target.database_name}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
  wr(wranglerArgs("export", target, { file }));
  console.log(`Backup written to ${file} (contains data; do not commit it).`);
} else if (cmd === "import") {
  const r = report();
  if (r.env !== "preview") {
    console.error(`Generated import is for env="${r.env}". Run: bun run db:build-import`);
    process.exit(2);
  }
  for (const f of r.generatedFiles) {
    console.log(`importing ${f}`);
    wr(wranglerArgs("file", target, { file: resolve(out, f) }));
  }
  console.log("done. Now run: bun scripts/db/preview-d1.mjs verify");
} else if (cmd === "verify") {
  const r = report();
  const n = (sql) => Object.values(query(sql)[0])[0];
  const checks = [
    [
      "environment marker is 'preview'",
      query("SELECT value FROM meta WHERE key='environment'")[0]?.value === "preview",
    ],
    ["categories", n("SELECT count(*) FROM categories") === r.expected.categories],
    ["tools", n("SELECT count(*) FROM tools") === r.expected.tools],
    [
      "flagged (draft + needs_review)",
      n("SELECT count(*) FROM tools WHERE needs_review=1 AND status='draft'") ===
        r.expected.flagged,
    ],
    ["unique slugs", n("SELECT count(DISTINCT slug) FROM tools") === r.expected.tools],
  ];
  checks.forEach(([k, ok]) => console.log(`${ok ? "PASS" : "FAIL"}  ${k}`));
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
} else if (cmd === "rollback") {
  const i = rest.indexOf("--confirm");
  if (i < 0 || rest[i + 1] !== target.database_name) {
    console.error(
      `Destructive. Re-run with: --confirm ${target.database_name}  (take a backup first)`,
    );
    process.exit(2);
  }
  const applied = query("SELECT name FROM d1_migrations").map((x) => x.name);
  let pick;
  try {
    pick = pickRollback(applied, readdirSync(resolve("db/rollback")));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  console.log(`Rolling back ${pick.migration} using db/rollback/${pick.down}`);
  wr(wranglerArgs("file", target, { file: resolve("db/rollback", pick.down) }));
  console.log("done (one migration rolled back).");
} else {
  console.error(
    "Usage: preview-d1.mjs migrate|import|verify|backup|status|rollback --confirm <name>",
  );
  process.exit(2);
}

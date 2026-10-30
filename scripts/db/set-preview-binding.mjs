#!/usr/bin/env bun
// Puts the PREVIEW D1 binding where Cloudflare documents it (previews.d1_databases) and writes
// wrangler.preview-migrations.jsonc for migration commands. DRY RUN by default: nothing is written without --write.
//   bun scripts/db/set-preview-binding.mjs <database_id> [database_name=tryaitools-preview] [--write] [--allow-comment-loss]
// database_id is the UUID printed by `bunx wrangler d1 create tryaitools-preview`; it is an identifier, not a secret.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MIGRATIONS_CONFIG_FILE,
  hasComments,
  parseJsonc,
  planPreviewBinding,
  validateRepoConfig,
} from "./wrangler-config.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [id, name = "tryaitools-preview"] = args.filter((a) => !a.startsWith("--"));
if (!id) {
  console.error(
    "Usage: bun scripts/db/set-preview-binding.mjs <database_id> [tryaitools-preview] [--write]",
  );
  process.exit(2);
}
const file = resolve("wrangler.jsonc");
const text = readFileSync(file, "utf8");
let plan;
try {
  plan = planPreviewBinding(parseJsonc(text), { databaseName: name, databaseId: id });
} catch (e) {
  console.error("Refusing:", e.message);
  process.exit(2);
}
const checks = validateRepoConfig(plan.config, plan.migrations);
console.log(
  plan.notes.length
    ? plan.notes.map((n) => `- ${n}`).join("\n")
    : "- no top-level D1 binding was present",
);
console.log("\nResulting wrangler.jsonc:\n" + JSON.stringify(plan.config, null, 2));
console.log(`\nResulting ${MIGRATIONS_CONFIG_FILE}:\n` + JSON.stringify(plan.migrations, null, 2));
console.log("\nIsolation checks on the result:");
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
if (checks.some((c) => !c.ok)) process.exit(1);
if (!flags.has("--write")) {
  console.log("\nDRY RUN: nothing was written. Re-run with --write to apply.");
  process.exit(0);
}
if (hasComments(text) && !flags.has("--allow-comment-loss")) {
  console.error(
    "\nwrangler.jsonc contains comments that would be lost. Re-run with --allow-comment-loss if that is acceptable.",
  );
  process.exit(2);
}
const backup = `wrangler.jsonc.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(file, resolve(backup));
writeFileSync(file, JSON.stringify(plan.config, null, 2) + "\n");
const mig = resolve(MIGRATIONS_CONFIG_FILE);
if (existsSync(mig)) copyFileSync(mig, resolve(`${MIGRATIONS_CONFIG_FILE}.bak`));
writeFileSync(
  mig,
  `// Used ONLY by \`wrangler d1 migrations/execute\` commands (see docs/preview-d1-isolation.md). Never deploy this file.\n` +
    JSON.stringify(plan.migrations, null, 2) +
    "\n",
);
console.log(
  `\nWritten. Backup of the old wrangler.jsonc: ${backup}\nReview with: git diff wrangler.jsonc`,
);

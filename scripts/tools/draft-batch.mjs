#!/usr/bin/env bun
// Generates grounded review drafts for a list of tools, locally, with the SAME pipeline the admin uses
// (src/lib/tools/review-draft.ts: official pages only, every claim quoted and verified, Gemini free tier, no paid
// fallback). It reads the tools from a snapshot and writes SQL that stores the drafts in the PREVIEW database
// (review_draft, review_status, review_notes; one audit row each). Nothing is published and indexing never changes:
// an editor approves each draft in the admin.
//
//   GEMINI_API_KEY=... bun scripts/tools/draft-batch.mjs --snapshot <export.sql> --slugs a,b,c --out <dir>
//   (or put GEMINI_API_KEY in the git-ignored .dev.vars; the key is never printed)
// Stops at the first free-quota (429) or key error and writes what it has so far.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateDraft } from "../../src/lib/tools/review-draft.ts";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const slugs = (arg("--slugs") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const out = arg("--out");
if (!snapshot || !slugs.length || !out) {
  console.error(
    "Usage: bun scripts/tools/draft-batch.mjs --snapshot <export.sql> --slugs a,b,c --out <dir>",
  );
  process.exit(2);
}
let key = process.env.GEMINI_API_KEY ?? "";
if (!key && existsSync(".dev.vars"))
  key = (/^GEMINI_API_KEY=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1] ?? "")
    .trim()
    .replace(/^"|"$/g, "");
if (!key) {
  console.error("GEMINI_API_KEY is not set (environment or .dev.vars). Nothing was done.");
  process.exit(2);
}
const model = process.env.NEWS_MODEL || "gemini-3.5-flash-lite";

const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const sql = [];
const results = [];
for (const slug of slugs) {
  const t = db
    .query(
      "SELECT t.*, c.name AS category_name FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = ?",
    )
    .get(slug);
  if (!t) {
    results.push({ slug, result: "not found" });
    continue;
  }
  const now = new Date().toISOString();
  process.stdout.write(`${slug} … `);
  const r = await generateDraft(
    { name: t.name, url: t.url, category: t.category_name, subcategory: t.subcategory },
    { apiKey: key, model, now },
  );
  if (!r.ok && r.deferred) {
    console.log(`deferred: ${r.reason}`);
    results.push({ slug, result: "deferred", reason: r.reason });
    if (r.stopRun) break;
    continue;
  }
  const draft = r.ok ? r.draft : null;
  const status = draft ? draft.quality.status : "needs_manual";
  const notes = draft
    ? draft.quality.reasons.join("; ") || null
    : `automated review failed: ${r.reason}`;
  console.log(status + (notes ? ` (${notes})` : ""));
  results.push({ slug, name: t.name, result: status, notes, draft });
  sql.push(
    `UPDATE tools SET review_draft = ${q(draft ? JSON.stringify(draft) : null)}, review_status = CASE WHEN review_status = 'reviewed' THEN 'reviewed' ELSE ${q(status)} END, review_notes = ${q(notes)}, url_checked_at = ${q(now)}, updated_at = ${q(now)} WHERE id = ${q(t.id)} AND updated_at = ${q(t.updated_at)};`,
    `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(now)}, 'draft-batch (approved review pilot)', 'tool.review_draft', 'tool', ${q(slug)}, ${q(draft ? `Generated review draft (${status})` : `Review draft failed: ${notes}`.slice(0, 200))});`,
  );
  await new Promise((res) => setTimeout(res, 4000)); // stay well inside the free tier's per-minute limit
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "drafts.sql"), sql.join("\n") + "\n");
writeFileSync(join(out, "drafts.json"), JSON.stringify(results, null, 1));
const count = (k) => results.filter((x) => x.result === k).length;
console.log(
  `\n${results.length} processed: ${count("draft_ready")} draft_ready, ${count("needs_manual")} needs_manual, ${count("deferred")} deferred. SQL: ${join(out, "drafts.sql")}`,
);

#!/usr/bin/env bun
// Generates (does NOT run) the SQL for the APPROVED dead-listing actions on the PREVIEW database, rehearses it on a local
// copy of the snapshot and checks that nothing else changes. Approved 2026-11-08 (docs/drafts/audit/dead-listings-verification.md):
//   - unpublish 21 confirmed-gone listings to draft
//   - update CodeGeeX and DocsGPT to their official URLs
//   - merge Movio into HeyGen and SeekWell into ThoughtSpot (archive + 301 via tool_redirects)
// Recorded as one bulk operation (undoable from the admin for status/review fields) with one audit row per tool.
// Every UPDATE is guarded by the tool's updated_at in the snapshot.
//   bun scripts/db/apply-dead-listings.mjs --snapshot <export.sql> --out <dir>
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const out = arg("--out");
if (!snapshot || !out) {
  console.error(
    "Usage: bun scripts/db/apply-dead-listings.mjs --snapshot <export.sql> --out <dir>",
  );
  process.exit(2);
}
const UNPUBLISH = [
  "ai-resume-builder",
  "ai-tutor-pro",
  "airgram",
  "bookmark-aida",
  "campus-management",
  "course-signals",
  "fable-ai",
  "formula-dog",
  "homeworkify",
  "magicvox",
  "minethedata",
  "paraphraser-tool",
  "phrase",
  "snatchbot",
  "supervoicechanger",
  "voice-craftr",
  "voicemodulator-ai",
  "amz-listing-optimizer",
  "blackbox-ai",
  "coqui-studio",
  "tome",
];
const URL_UPDATES = {
  codegeex: {
    url: "https://codegeex.cn",
    source: "official repository github.com/zai-org/CodeGeeX lists codegeex.cn",
  },
  docsgpt: {
    url: "https://www.docsgpt.cloud",
    source: "official repository github.com/arc53/DocsGPT links docsgpt.cloud",
  },
};
const MERGES = {
  movio: {
    into: "heygen",
    source: "Movio rebranded to HeyGen (official press release, newswire.com)",
  },
  seekwell: {
    into: "thoughtspot",
    source: "ThoughtSpot acquired SeekWell (official ThoughtSpot press release)",
  },
};
const UNTOUCHED = ["audiogen-meta", "noisetorch", "voice-changer-plus", "coqui-tts"];

const NOW = new Date().toISOString();
const OP = crypto.randomUUID();
const ACTOR = "dead-listings-script (approved preview actions)";
const q = (v) =>
  v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
const get = (slug) => db.query("SELECT * FROM tools WHERE slug = ?").get(slug);
const mems = (id) =>
  db
    .query(
      "SELECT category_id, subcategory FROM tool_categories WHERE tool_id = ? ORDER BY category_id",
    )
    .all(id)
    .map((m) => ({ category_id: m.category_id, subcategory: m.subcategory ?? null }));
const stateOf = (t) => ({
  category_id: t.category_id,
  subcategory: t.subcategory ?? null,
  indexing: t.indexing,
  status: t.status,
  review_status: t.review_status ?? "unreviewed",
  needs_review: Number(t.needs_review),
  pricing_model: t.pricing_model ?? null,
  tags: JSON.parse(t.tags ?? "[]"),
  memberships: mems(t.id),
});
const note = (t, s) => (t.review_notes ? `${t.review_notes} | ${s}` : s).slice(0, 1000);

const sql = [
  `INSERT INTO bulk_operations (id, actor_email, action, summary, total, status, created_at, updated_at) VALUES (${q(OP)}, ${q(ACTOR)}, 'dead_listings', 'Approved dead-listing actions: 21 unpublished, 2 URL updates, 2 merges (preview)', 0, 'running', ${q(NOW)}, ${q(NOW)});`,
];
const plan = [];
const problems = [];
const touched = new Set();
const item = (t, after) =>
  sql.push(
    `INSERT INTO bulk_operation_items (op_id, tool_id, slug, before, after) VALUES (${q(OP)}, ${q(t.id)}, ${q(t.slug)}, ${q(JSON.stringify(stateOf(t)))}, ${q(JSON.stringify(after))});`,
  );
const audit = (slug, summary) =>
  sql.push(
    `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(NOW)}, ${q(ACTOR)}, 'tool.dead_listing', 'tool', ${q(slug)}, ${q(summary.slice(0, 200))});`,
  );

for (const slug of UNPUBLISH) {
  const t = get(slug);
  if (!t || t.status !== "published") {
    problems.push(`${slug}: expected a published tool, found ${t ? t.status : "nothing"}`);
    continue;
  }
  touched.add(slug);
  const after = { ...stateOf(t), status: "draft", indexing: "noindex" };
  sql.push(
    `UPDATE tools SET status = 'draft', indexing = 'noindex', review_notes = ${q(note(t, `unpublished ${NOW.slice(0, 10)}: official URL confirmed gone (dead-listing review)`))}, updated_at = ${q(NOW)} WHERE id = ${q(t.id)} AND updated_at = ${q(t.updated_at)};`,
  );
  item(t, after);
  audit(slug, "Unpublished to draft: official URL confirmed gone (approved dead-listing review)");
  plan.push({ slug, action: "unpublish to draft", from: "published", to: "draft" });
}
for (const [slug, u] of Object.entries(URL_UPDATES)) {
  const t = get(slug);
  if (!t || t.status !== "published") {
    problems.push(`${slug}: expected a published tool`);
    continue;
  }
  touched.add(slug);
  // the URL problem is resolved: back to the normal review queue (it was 'needs_manual' only because of the dead URL)
  const review = t.review_status === "needs_manual" ? "unreviewed" : t.review_status;
  const after = { ...stateOf(t), review_status: review };
  sql.push(
    `UPDATE tools SET url = ${q(u.url)}, url_status = 'ok', url_checked_at = ${q(NOW)}, review_status = ${q(review)}, review_notes = ${q(note(t, `url ${t.url} -> ${u.url} (${u.source})`))}, updated_at = ${q(NOW)} WHERE id = ${q(t.id)} AND updated_at = ${q(t.updated_at)};`,
  );
  item(t, after);
  audit(slug, `URL updated: ${t.url} -> ${u.url} (${u.source})`);
  plan.push({
    slug,
    action: "update URL",
    from: t.url,
    to: u.url,
    review: `${t.review_status} -> ${review}`,
  });
}
for (const [slug, m] of Object.entries(MERGES)) {
  const t = get(slug);
  const target = get(m.into);
  if (!t || t.status !== "published" || !target || target.status !== "published") {
    problems.push(`${slug} -> ${m.into}: both must be published`);
    continue;
  }
  if (db.query("SELECT 1 FROM tool_redirects WHERE old_slug = ?").get(slug))
    problems.push(`${slug}: a redirect already exists`);
  touched.add(slug);
  const sameCategory = t.category_id === target.category_id;
  const after = { ...stateOf(t), status: "archived", indexing: "noindex" };
  sql.push(
    `UPDATE tools SET status = 'archived', indexing = 'noindex', review_notes = ${q(note(t, `merged into ${m.into} (${m.source}): archived, 301 -> /tools/${m.into}`))}, updated_at = ${q(NOW)} WHERE id = ${q(t.id)} AND updated_at = ${q(t.updated_at)};`,
    `INSERT INTO tool_redirects (old_slug, tool_id, created_at) VALUES (${q(slug)}, ${q(target.id)}, ${q(NOW)});`,
  );
  item(t, after);
  audit(slug, `Merged into ${m.into}: archived, 301 -> /tools/${m.into} (${m.source})`);
  plan.push({
    slug,
    action: "merge (archive + 301)",
    to: `/tools/${m.into}`,
    sameCategory,
    membershipNeeded: !sameCategory,
  });
}
sql.push(
  `UPDATE bulk_operations SET total = ${plan.length}, applied = ${plan.length}, status = 'done', updated_at = ${q(NOW)} WHERE id = ${q(OP)};`,
  `INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', ${q(`${NOW}#${OP}`)}, ${q(NOW)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
);
if (problems.length) {
  console.error("NOT WRITTEN:\n" + problems.join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------- rehearsal + invariants
const before = new Map(
  db
    .query("SELECT * FROM tools")
    .all()
    .map((t) => [t.slug, t]),
);
const beforeCounts = {
  status: db.query("SELECT status, count(*) n FROM tools GROUP BY 1 ORDER BY 1").all(),
  memberships: db.query("SELECT count(*) n FROM tool_categories").get().n,
  redirects: db.query("SELECT count(*) n FROM tool_redirects").get().n,
};
db.exec("PRAGMA foreign_keys = ON;");
db.exec(sql.join("\n"));
const afterRows = db.query("SELECT * FROM tools").all();
const changed = afterRows
  .filter((t) => JSON.stringify(t) !== JSON.stringify(before.get(t.slug)))
  .map((t) => t.slug);
const indexChanged = afterRows
  .filter((t) => t.indexing !== before.get(t.slug).indexing)
  .map((t) => t.slug);
const one = (s) => db.query(s).get();
const redirect = (slug) =>
  db
    .query(
      `SELECT t.slug, t.status FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE r.old_slug = ?`,
    )
    .get(slug);
const inv = {
  integrity: one("PRAGMA integrity_check").integrity_check,
  fkViolations: db.query("PRAGMA foreign_key_check").all().length,
  onlyApprovedToolsChanged: changed.length === touched.size && changed.every((s) => touched.has(s)),
  changedCount: changed.length,
  indexingChanged: indexChanged, // must be empty: every affected tool was already noindex
  untouchedUnchanged: UNTOUCHED.every(
    (s) => JSON.stringify(get(s)) === JSON.stringify(before.get(s)),
  ),
  draftsPreserved: db
    .query("SELECT slug FROM tools WHERE review_draft IS NOT NULL ORDER BY slug")
    .all()
    .map((x) => x.slug),
  redirects: { movio: redirect("movio"), seekwell: redirect("seekwell") },
  statusAfter: db.query("SELECT status, count(*) n FROM tools GROUP BY 1 ORDER BY 1").all(),
  membershipsAfter: one("SELECT count(*) n FROM tool_categories").n,
  redirectsAfter: one("SELECT count(*) n FROM tool_redirects").n,
  indexedAfter: one("SELECT count(*) n FROM tools WHERE indexing = 'index'").n,
  urls: { codegeex: get("codegeex").url, docsgpt: get("docsgpt").url },
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "dead-listings.sql"), sql.join("\n") + "\n");
const report = { op: OP, now: NOW, plan, beforeCounts, rehearsal: inv };
writeFileSync(join(out, "dead-listings-report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
const ok =
  inv.integrity === "ok" &&
  inv.fkViolations === 0 &&
  inv.onlyApprovedToolsChanged &&
  inv.indexingChanged.length === 0 &&
  inv.untouchedUnchanged &&
  inv.redirects.movio?.slug === "heygen" &&
  inv.redirects.movio?.status === "published" &&
  inv.redirects.seekwell?.slug === "thoughtspot" &&
  inv.redirects.seekwell?.status === "published";
console.log(ok ? "REHEARSAL OK" : "REHEARSAL FAILED: do not apply");
process.exit(ok ? 0 : 1);

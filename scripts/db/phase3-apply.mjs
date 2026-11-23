#!/usr/bin/env bun
// Generates (does NOT run) the Phase 3 SQL for the PREVIEW database from a snapshot and a decisions file
// (docs/drafts/audit/index-readiness-2026-11-12/phase3-decisions.json):
//   url       official URL moved (same product)              -> tools.url updated
//   rename    same product under a new name                    -> tools.name (+ url) updated, slug kept
//   unpublish product discontinued / gone                      -> status 'draft', noindex, needs_manual + note
//   merge     product absorbed by a listed successor           -> archived, 301 (tool_redirects), category membership
// Status / membership changes are bulk_operation_items (undo from Admin > Tools > Recent bulk operations); url / name
// changes are written to a rollback SQL file. One audit row per tool. Every UPDATE is guarded by updated_at.
//   bun scripts/db/phase3-apply.mjs --snapshot <export.sql> --decisions <json> --out <dir> [--now <ISO>]
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const [snapshot, decFile, out] = ["--snapshot", "--decisions", "--out"].map(arg);
const NOW = arg("--now") ?? new Date().toISOString();
if (!snapshot || !decFile || !out) {
  console.error(
    "Usage: bun scripts/db/phase3-apply.mjs --snapshot <export.sql> --decisions <json> --out <dir>",
  );
  process.exit(2);
}
const ACTOR = "phase3-apply (dead and outdated listings, preview)";
const OP_ID = crypto.randomUUID();
const dec = JSON.parse(readFileSync(decFile, "utf8"));
const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
const bySlug = new Map(
  db
    .query("SELECT * FROM tools")
    .all()
    .map((t) => [t.slug, t]),
);
const mems = db.query("SELECT tool_id, category_id, subcategory FROM tool_categories").all();
const memsOf = (id) =>
  mems
    .filter((m) => m.tool_id === id)
    .map(({ category_id, subcategory }) => ({ category_id, subcategory }));
const parse = (v, d) => {
  try {
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const stateOf = (t, m) => ({
  category_id: t.category_id,
  subcategory: t.subcategory ?? null,
  indexing: t.indexing,
  status: t.status,
  review_status: t.review_status ?? "unreviewed",
  needs_review: Number(t.needs_review),
  pricing_model: t.pricing_model ?? null,
  tags: parse(t.tags, []),
  memberships: [...m].sort((a, b) => a.category_id.localeCompare(b.category_id)),
});
const q = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const isUrl = (u) => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s'"]*)?$/i.test(u);

const sql = [
  `-- Phase 3 (dead and outdated listings), generated ${new Date().toISOString()} from ${snapshot}. Bulk operation ${OP_ID}.`,
  `-- Undo status/membership changes: Admin > Tools > Recent bulk operations > Undo. URL/name changes: phase3-rollback.sql.`,
  `INSERT INTO bulk_operations (id, actor_email, action, summary, total, status, created_at, updated_at) VALUES (${q(OP_ID)}, ${q(ACTOR)}, 'catalogue_cleanup', 'Phase 3: URL corrections, renames, dead listings unpublished, successors merged', 0, 'running', ${q(NOW)}, ${q(NOW)});`,
];
const rollback = [
  `-- Rollback of the url / name changes from bulk operation ${OP_ID} (run after Undo in the admin).`,
];
const report = {
  opId: OP_ID,
  now: NOW,
  url: 0,
  rename: 0,
  unpublish: 0,
  merge: 0,
  membershipsAdded: 0,
  errors: [],
};
const touched = new Map(); // slug -> { t, sets[], notes[], after }
const touch = (slug) => {
  const t = bySlug.get(slug);
  if (!t) return (report.errors.push(`${slug}: not found`), null);
  if (t.status !== "published")
    return (report.errors.push(`${slug}: status ${t.status}, skipped`), null);
  if (!touched.has(slug))
    touched.set(slug, {
      t,
      sets: [],
      notes: [],
      after: stateOf(t, memsOf(t.id)),
      addMems: [],
      redirectTo: null,
    });
  return touched.get(slug);
};
for (const [slug, url] of Object.entries(dec.url ?? {})) {
  const p = touch(slug);
  if (!p) continue;
  if (!isUrl(url)) {
    report.errors.push(`${slug}: bad url ${url}`);
    continue;
  }
  if (url === p.t.url) continue;
  p.sets.push(`url = ${q(url)}`, `url_status = 'ok'`, `url_checked_at = ${q(NOW)}`);
  p.notes.push(`url ${p.t.url} -> ${url}`);
  rollback.push(`UPDATE tools SET url = ${q(p.t.url)} WHERE id = ${q(p.t.id)};`);
  report.url++;
}
for (const [slug, [name, url]] of Object.entries(dec.rename ?? {})) {
  const p = touch(slug);
  if (!p) continue;
  if (url && !isUrl(url)) {
    report.errors.push(`${slug}: bad url ${url}`);
    continue;
  }
  p.sets.push(`name = ${q(name)}`);
  p.notes.push(`renamed ${p.t.name} -> ${name}`);
  rollback.push(`UPDATE tools SET name = ${q(p.t.name)} WHERE id = ${q(p.t.id)};`);
  if (url && url !== p.t.url) {
    p.sets.push(`url = ${q(url)}`, `url_status = 'ok'`, `url_checked_at = ${q(NOW)}`);
    p.notes.push(`url ${p.t.url} -> ${url}`);
    rollback.push(`UPDATE tools SET url = ${q(p.t.url)} WHERE id = ${q(p.t.id)};`);
  }
  report.rename++;
}
for (const [slug, why] of Object.entries(dec.unpublish ?? {})) {
  const p = touch(slug);
  if (!p) continue;
  if (p.t.indexing === "index") {
    report.errors.push(`${slug}: indexed, not unpublished automatically`);
    continue;
  }
  p.after = { ...p.after, status: "draft", indexing: "noindex", review_status: "needs_manual" };
  p.notes.push(`unpublished (dead listing): ${why}`);
  report.unpublish++;
}
for (const [slug, primarySlug] of Object.entries(dec.merge ?? {})) {
  const p = touch(slug);
  const prim = bySlug.get(primarySlug);
  if (!p) continue;
  if (!prim || prim.status !== "published") {
    report.errors.push(`${slug}: successor ${primarySlug} not published`);
    continue;
  }
  if (p.t.indexing === "index") {
    report.errors.push(`${slug}: indexed, not merged automatically`);
    continue;
  }
  p.after = { ...p.after, status: "archived", indexing: "noindex", memberships: [] };
  p.redirectTo = prim;
  p.notes.push(`absorbed by ${primarySlug}: archived, 301 -> /tools/${primarySlug}`);
  const pp = touch(primarySlug);
  const have = new Set([
    prim.category_id,
    ...pp.after.memberships.map((m) => m.category_id),
    ...pp.addMems.map((m) => m.category_id),
  ]);
  for (const m of [
    { category_id: p.t.category_id, subcategory: p.t.subcategory ?? null },
    ...memsOf(p.t.id),
  ])
    if (!have.has(m.category_id)) {
      have.add(m.category_id);
      pp.addMems.push(m);
      report.membershipsAdded++;
    }
  report.merge++;
}
let items = 0,
  guarded = 0;
for (const p of touched.values()) {
  const t = p.t;
  const before = stateOf(t, memsOf(t.id));
  if (p.addMems.length)
    p.after = {
      ...p.after,
      memberships: [...p.after.memberships, ...p.addMems].sort((a, b) =>
        a.category_id.localeCompare(b.category_id),
      ),
    };
  const sets = [...p.sets];
  for (const k of ["status", "indexing", "review_status"])
    if (before[k] !== p.after[k]) sets.push(`${k} = ${q(p.after[k])}`);
  if (p.notes.length) sets.push(`review_notes = ${q(p.notes.join(" | ").slice(0, 1000))}`);
  sets.push(`updated_at = ${q(NOW)}`);
  if (p.redirectTo) sql.push(`DELETE FROM tool_categories WHERE tool_id = ${q(t.id)};`);
  sql.push(
    `UPDATE tools SET ${sets.join(", ")} WHERE id = ${q(t.id)} AND updated_at = ${q(t.updated_at)};`,
  );
  guarded++;
  const start = memsOf(t.id).length;
  for (const [i, m] of p.addMems.entries())
    sql.push(
      `INSERT INTO tool_categories (tool_id, category_id, subcategory, sort_order, created_at) VALUES (${q(t.id)}, ${q(m.category_id)}, ${q(m.subcategory)}, ${start + i}, ${q(NOW)});`,
    );
  if (p.redirectTo)
    sql.push(
      `INSERT OR IGNORE INTO tool_redirects (old_slug, tool_id, created_at) VALUES (${q(t.slug)}, ${q(p.redirectTo.id)}, ${q(NOW)});`,
    );
  if (JSON.stringify(before) !== JSON.stringify(p.after)) {
    sql.push(
      `INSERT INTO bulk_operation_items (op_id, tool_id, slug, before, after) VALUES (${q(OP_ID)}, ${q(t.id)}, ${q(t.slug)}, ${q(JSON.stringify(before))}, ${q(JSON.stringify(p.after))});`,
    );
    items++;
  }
  sql.push(
    `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(NOW)}, ${q(ACTOR)}, 'tool.cleanup', 'tool', ${q(t.slug)}, ${q((p.notes.join("; ") || "category memberships from absorbed listings").slice(0, 200))});`,
  );
}
sql.push(
  `UPDATE bulk_operations SET total = ${items}, applied = ${items}, status = 'done', updated_at = ${q(NOW)} WHERE id = ${q(OP_ID)};`,
);
sql.push(
  `INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', ${q(`${NOW}#${OP_ID}`)}, ${q(NOW)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
);
report.undoableItems = items;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "phase3.sql"), sql.join("\n") + "\n");
writeFileSync(join(out, "phase3-rollback.sql"), rollback.join("\n") + "\n");

const one = (s) => db.query(s).get();
const idx = one("SELECT count(*) n FROM tools WHERE indexing='index'").n;
db.exec("PRAGMA foreign_keys = ON;");
db.exec(sql.join("\n"));
report.rehearsal = {
  integrity: one("PRAGMA integrity_check").integrity_check,
  fkViolations: db.query("PRAGMA foreign_key_check").all().length,
  allGuardedUpdatesApplied:
    one(`SELECT count(*) n FROM tools WHERE updated_at = ${q(NOW)}`).n === guarded,
  indexedUnchanged: one("SELECT count(*) n FROM tools WHERE indexing='index'").n === idx,
  redirectsToPublished:
    one(
      `SELECT count(*) n FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE r.created_at = ${q(NOW)} AND t.status <> 'published'`,
    ).n === 0,
  membershipNeverPrimary:
    one(
      "SELECT count(*) n FROM tool_categories m JOIN tools t ON t.id = m.tool_id WHERE m.category_id = t.category_id",
    ).n === 0,
};
writeFileSync(join(out, "phase3-report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
const r = report.rehearsal;
if (
  r.integrity !== "ok" ||
  r.fkViolations ||
  !r.allGuardedUpdatesApplied ||
  !r.indexedUnchanged ||
  !r.redirectsToPublished ||
  !r.membershipNeverPrimary
) {
  console.error("REHEARSAL FAILED");
  process.exit(1);
}
console.log("REHEARSAL PASSED");

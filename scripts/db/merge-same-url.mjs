#!/usr/bin/env bun
// Generates (does NOT run) the Phase 2 duplicate-merge SQL for the PREVIEW database from a snapshot:
// published listings that share the exact same official URL (host + path) are one product. Per group, one primary is
// kept; every other listing is archived (reversible), gets a 301 (tool_redirects) to the primary, and its category
// becomes a shared membership of the primary so category pages keep showing the product.
// Everything is ONE bulk operation (undo from Admin > Tools > Recent bulk operations) plus one audit row per tool.
// Every UPDATE is guarded by the tool's updated_at from the snapshot; the rehearsal fails if any guard misses.
//
//   bun scripts/db/merge-same-url.mjs --snapshot <export.sql> --out <dir> [--pre <sql>] [--exclude url1,url2] [--now <ISO>]
// Writes <dir>/merge.sql, <dir>/merge-plan.csv, <dir>/merge-report.json and rehearses the SQL on a local copy.
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const out = arg("--out");
const EXCLUDE = new Set((arg("--exclude") ?? "").split(",").filter(Boolean));
// --primary url=slug,url=slug: a person's choice of primary for a group (beats the automatic choice)
const PRIMARY = new Map(
  (arg("--primary") ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => p.split("=")),
);
const NOW = arg("--now") ?? new Date().toISOString();
if (!snapshot || !out) {
  console.error(
    "Usage: bun scripts/db/merge-same-url.mjs --snapshot <export.sql> --out <dir> [--exclude urls]",
  );
  process.exit(2);
}
const ACTOR = "merge-same-url (Phase 2 duplicate cleanup, preview)";
const OP_ID = crypto.randomUUID();
const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
// --pre <sql>: SQL that will run on the database first (e.g. phase3.sql); planning starts from that state
const pre = arg("--pre");
if (pre) db.exec(readFileSync(pre, "utf8"));

const norm = (u) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return "";
  }
};
const parse = (v, d) => {
  try {
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const REVIEW_RANK = { reviewed: 0, draft_ready: 1, unreviewed: 2, needs_manual: 3 };
const pub = db
  .query("SELECT * FROM tools WHERE status = 'published' ORDER BY sort_order, id")
  .all();
const mems = db.query("SELECT tool_id, category_id, subcategory FROM tool_categories").all();
const redirectsTo = new Map(
  db
    .query("SELECT tool_id, count(*) n FROM tool_redirects GROUP BY tool_id")
    .all()
    .map((r) => [r.tool_id, r.n]),
);
const memsOf = (id) =>
  mems
    .filter((m) => m.tool_id === id)
    .map(({ category_id, subcategory }) => ({ category_id, subcategory }));
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

const groups = new Map();
for (const t of pub) {
  const k = norm(t.url);
  if (!k || EXCLUDE.has(k)) continue;
  groups.set(k, [...(groups.get(k) ?? []), t]);
}
const plan = []; // { primary, copies[], newMemberships[] }
const report = {
  opId: OP_ID,
  now: NOW,
  groups: 0,
  copiesArchived: 0,
  membershipsAdded: 0,
  redirectsAdded: 0,
  excluded: [...EXCLUDE],
  skipped: [],
};
for (const [k, list] of groups) {
  if (list.length < 2) continue;
  const indexed = list.filter((t) => t.indexing === "index");
  if (indexed.length > 1) {
    report.skipped.push(`${k}: ${indexed.length} indexed listings (needs a person)`);
    continue;
  }
  // primary: the indexed one, else a person's choice, else the listing earlier merges already redirect to, else the
  // plain brand listing (shortest name: "Drift" beats "Drift Chatbot"), then review state, then catalogue order
  const inbound = (t) => redirectsTo.get(t.id) ?? 0;
  const primary =
    indexed[0] ??
    list.find((t) => t.slug === PRIMARY.get(k)) ??
    [...list].sort(
      (a, b) =>
        inbound(b) - inbound(a) ||
        a.name.length - b.name.length ||
        (REVIEW_RANK[a.review_status] ?? 2) - (REVIEW_RANK[b.review_status] ?? 2) ||
        a.sort_order - b.sort_order,
    )[0];
  const have = new Set([primary.category_id, ...memsOf(primary.id).map((m) => m.category_id)]);
  const added = [];
  for (const c of list) {
    if (c.id === primary.id) continue;
    for (const m of [
      { category_id: c.category_id, subcategory: c.subcategory ?? null },
      ...memsOf(c.id),
    ])
      if (!have.has(m.category_id)) {
        have.add(m.category_id);
        added.push(m);
      }
  }
  plan.push({ key: k, primary, copies: list.filter((t) => t.id !== primary.id), added });
  report.groups++;
}

const q = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const sql = [
  `-- Phase 2 duplicate merge (same official URL), generated ${new Date().toISOString()} from ${snapshot}. Bulk operation ${OP_ID}.`,
  `-- Undo: Admin > Tools > Recent bulk operations > Undo. Redirect rows: DELETE FROM tool_redirects WHERE created_at = ${q(NOW)};`,
  `INSERT INTO bulk_operations (id, actor_email, action, summary, total, status, created_at, updated_at) VALUES (${q(OP_ID)}, ${q(ACTOR)}, 'catalogue_cleanup', 'Phase 2: merge listings that share one official URL (archive + 301 + category membership)', 0, 'running', ${q(NOW)}, ${q(NOW)});`,
];
const csv = [
  ["url", "primary", "primary_indexing", "archived_copy", "copy_category", "membership_added"].join(
    ",",
  ),
];
let items = 0;
const pushItem = (t, before, after) => {
  sql.push(
    `INSERT INTO bulk_operation_items (op_id, tool_id, slug, before, after) VALUES (${q(OP_ID)}, ${q(t.id)}, ${q(t.slug)}, ${q(JSON.stringify(before))}, ${q(JSON.stringify(after))});`,
  );
  items++;
};
let guarded = 0;
for (const g of plan) {
  const p = g.primary;
  if (g.added.length) {
    const before = stateOf(p, memsOf(p.id));
    const after = stateOf(p, [...memsOf(p.id), ...g.added]);
    sql.push(
      `UPDATE tools SET updated_at = ${q(NOW)} WHERE id = ${q(p.id)} AND updated_at = ${q(p.updated_at)};`,
    );
    guarded++;
    const start = memsOf(p.id).length;
    for (const [i, m] of g.added.entries())
      sql.push(
        `INSERT INTO tool_categories (tool_id, category_id, subcategory, sort_order, created_at) VALUES (${q(p.id)}, ${q(m.category_id)}, ${q(m.subcategory)}, ${start + i}, ${q(NOW)});`,
      );
    pushItem(p, before, after);
    report.membershipsAdded += g.added.length;
    sql.push(
      `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(NOW)}, ${q(ACTOR)}, 'tool.cleanup', 'tool', ${q(p.slug)}, ${q(`primary of ${g.key}: +${g.added.length} category memberships from merged copies`)});`,
    );
  }
  for (const c of g.copies) {
    const before = stateOf(c, memsOf(c.id));
    const after = { ...before, status: "archived", indexing: "noindex", memberships: [] };
    const note = `duplicate of ${p.slug} (same URL ${g.key}): archived, 301 -> /tools/${p.slug}`;
    sql.push(`DELETE FROM tool_categories WHERE tool_id = ${q(c.id)};`);
    sql.push(
      `UPDATE tools SET status = 'archived', indexing = 'noindex', review_notes = ${q(note)}, updated_at = ${q(NOW)} WHERE id = ${q(c.id)} AND updated_at = ${q(c.updated_at)};`,
    );
    guarded++;
    // earlier redirects that ended at this copy now end at the primary (one hop, never a 404)
    sql.push(`UPDATE tool_redirects SET tool_id = ${q(p.id)} WHERE tool_id = ${q(c.id)};`);
    sql.push(
      `INSERT OR IGNORE INTO tool_redirects (old_slug, tool_id, created_at) VALUES (${q(c.slug)}, ${q(p.id)}, ${q(NOW)});`,
    );
    pushItem(c, before, after);
    sql.push(
      `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(NOW)}, ${q(ACTOR)}, 'tool.cleanup', 'tool', ${q(c.slug)}, ${q(note.slice(0, 200))});`,
    );
    report.copiesArchived++;
    report.redirectsAdded++;
    csv.push(
      [
        g.key,
        p.slug,
        p.indexing,
        c.slug,
        `${c.category_id}/${c.subcategory ?? ""}`,
        g.added.some((m) => m.category_id === c.category_id) ? "yes" : "no",
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
}
sql.push(
  `UPDATE bulk_operations SET total = ${items}, applied = ${items}, status = 'done', updated_at = ${q(NOW)} WHERE id = ${q(OP_ID)};`,
);
sql.push(
  `INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', ${q(`${NOW}#${OP_ID}`)}, ${q(NOW)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
);
report.undoableItems = items;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "merge.sql"), sql.join("\n") + "\n");
writeFileSync(join(out, "merge-plan.csv"), csv.join("\n") + "\n");

// rehearsal on the local copy + invariants
const one = (s) => db.query(s).get();
const before = {
  published: one("SELECT count(*) n FROM tools WHERE status='published'").n,
  indexed: one("SELECT count(*) n FROM tools WHERE indexing='index'").n,
  redirects: one("SELECT count(*) n FROM tool_redirects").n,
};
db.exec("PRAGMA foreign_keys = ON;");
db.exec(sql.join("\n"));
const inv = {
  integrity: one("PRAGMA integrity_check").integrity_check,
  fkViolations: db.query("PRAGMA foreign_key_check").all().length,
  allGuardedUpdatesApplied:
    one(`SELECT count(*) n FROM tools WHERE updated_at = ${q(NOW)}`).n === guarded,
  indexedUnchanged: one("SELECT count(*) n FROM tools WHERE indexing='index'").n === before.indexed,
  publishedBefore: before.published,
  publishedAfter: one("SELECT count(*) n FROM tools WHERE status='published'").n,
  redirectsAdded: one("SELECT count(*) n FROM tool_redirects").n - before.redirects,
  redirectsResolveToPublished:
    one(
      `SELECT count(*) n FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE r.created_at = ${q(NOW)} AND t.status = 'published'`,
    ).n === report.redirectsAdded,
  noRedirectEndsAtArchived:
    one(
      "SELECT count(*) n FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE t.status = 'archived'",
    ).n === 0,
  redirectSlugsArchived:
    one(
      `SELECT count(*) n FROM tool_redirects r JOIN tools o ON o.slug = r.old_slug WHERE r.created_at = ${q(NOW)} AND o.status <> 'archived'`,
    ).n === 0,
  sameUrlPublishedGroupsLeft: (() => {
    const m = new Map();
    for (const t of db.query("SELECT url FROM tools WHERE status='published'").all()) {
      const k = norm(t.url);
      if (k && !EXCLUDE.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.values()].filter((n) => n > 1).length;
  })(),
  membershipNeverPrimary:
    one(
      "SELECT count(*) n FROM tool_categories m JOIN tools t ON t.id = m.tool_id WHERE m.category_id = t.category_id",
    ).n === 0,
  membershipsValid:
    one(
      "SELECT count(*) n FROM tool_categories m JOIN categories c ON c.id = m.category_id WHERE m.subcategory IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(c.subcategories) WHERE value = m.subcategory)",
    ).n === 0,
};
report.rehearsal = inv;
writeFileSync(join(out, "merge-report.json"), JSON.stringify(report, null, 1));
console.log(
  JSON.stringify(
    {
      groups: report.groups,
      copies: report.copiesArchived,
      memberships: report.membershipsAdded,
      skipped: report.skipped.length,
      ...inv,
    },
    null,
    1,
  ),
);
const ok =
  inv.integrity === "ok" &&
  inv.noRedirectEndsAtArchived &&
  inv.fkViolations === 0 &&
  inv.allGuardedUpdatesApplied &&
  inv.indexedUnchanged &&
  inv.redirectsResolveToPublished &&
  inv.redirectSlugsArchived &&
  inv.sameUrlPublishedGroupsLeft === 0 &&
  inv.membershipNeverPrimary &&
  inv.membershipsValid;
if (!ok) {
  console.error("REHEARSAL FAILED");
  process.exit(1);
}
console.log("REHEARSAL PASSED");

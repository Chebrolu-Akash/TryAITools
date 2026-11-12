#!/usr/bin/env bun
// Generates (does NOT run) the catalogue cleanup SQL for the PREVIEW database, from a snapshot and a URL-check file:
//   1. cross-category copies of one product (same name, same website) -> one primary listing; each copy becomes a shared
//      category membership of the primary, is archived (reversible) and gets a 301 (tool_redirects) to the primary
//   2. the 9 misfiled indexed tools move to their approved category (URLs unchanged)
//   3. url_status / url_checked_at from the URL check; a URL is updated only when it now redirects to the same brand;
//      anything doubtful is marked review_status = 'needs_manual' (nothing is unpublished or deleted)
// Everything is recorded as ONE bulk operation (bulk_operations / bulk_operation_items) so it can be undone from the
// admin, plus one audit row per tool. Every UPDATE is guarded by the tool's updated_at from the snapshot.
//
//   bun scripts/db/cleanup-duplicates.mjs --snapshot <export.sql> --urls <urlcheck.json> --out <dir> [--now <ISO>]
// Writes <dir>/cleanup.sql, <dir>/cleanup-changes.csv and <dir>/cleanup-report.json, and rehearses the SQL on a local
// copy of the snapshot (with migration 0010 applied), checking invariants. Nothing remote is contacted.
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const urlFile = arg("--urls");
// Optional: a snapshot from BEFORE any URL was updated. Duplicate groups use each tool's ORIGINAL website, so a primary
// whose URL was later moved to its rebrand domain (e.g. surferseo.com -> surfer.ai) still groups with its copies.
const historyFile = arg("--history");
const out = arg("--out");
const NOW = arg("--now") ?? new Date().toISOString();
if (!snapshot || !urlFile || !out) {
  console.error(
    "Usage: bun scripts/db/cleanup-duplicates.mjs --snapshot <export.sql> --urls <urlcheck.json> --out <dir>",
  );
  process.exit(2);
}
const ACTOR = "cleanup-script (approved preview cleanup)";
const OP_ID = crypto.randomUUID();

const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
const hasCol = db
  .query("PRAGMA table_info(tools)")
  .all()
  .some((c) => c.name === "review_status");
if (!hasCol) db.exec(readFileSync("migrations/0010_tool_review_bulk.sql", "utf8"));
const urls = JSON.parse(readFileSync(urlFile, "utf8"));
const originalUrl = new Map();
if (historyFile) {
  const h = new Database(":memory:");
  h.exec(readFileSync(historyFile, "utf8"));
  for (const r of h.query("SELECT id, url FROM tools").all()) originalUrl.set(r.id, r.url);
}

const tools = db.query("SELECT * FROM tools ORDER BY sort_order, id").all();
const cats = new Map(
  db
    .query("SELECT id, slug, status, subcategories FROM categories")
    .all()
    .map((c) => [c.id, { ...c, subs: JSON.parse(c.subcategories) }]),
);
const base = (n) =>
  n
    .replace(/\s*\(.+\)\s*$/, "")
    .trim()
    .toLowerCase();
const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const siteOf = (t) => host(originalUrl.get(t.id) ?? t.url);
const label = (h) => h.split(".").slice(-2)[0] ?? ""; // "claude" for claude.ai / claude.com
const sameBrand = (a, b) => {
  const x = label(a),
    y = label(b);
  return (
    !!x &&
    !!y &&
    (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))))
  );
};
const parse = (v, d) => {
  try {
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const stateOf = (t, mems) => ({
  category_id: t.category_id,
  subcategory: t.subcategory ?? null,
  indexing: t.indexing,
  status: t.status,
  review_status: t.review_status ?? "unreviewed",
  needs_review: Number(t.needs_review),
  pricing_model: t.pricing_model ?? null,
  tags: parse(t.tags, []),
  memberships: [...mems].sort((a, b) => a.category_id.localeCompare(b.category_id)),
});

// ---------------------------------------------------------------- the approved category corrections (Week 1, D)
const MOVES = {
  midjourney: ["ai-image-tools", "AI Image Generation Tools"],
  "cursor-ai": ["ai-coding-developer-tools", "AI Coding Tools"],
  "runway-ml": ["ai-video-tools", "AI Video Generation Tools"],
  synthesia: ["ai-video-tools", "AI Video Avatar Tools"],
  heygen: ["ai-video-tools", "AI Video Avatar Tools"],
  elevenlabs: ["ai-audio-voice-tools", "AI Voice Generation Tools"],
  "murf-ai": ["ai-audio-voice-tools", "AI Voice Generation Tools"],
  "otter-ai": ["ai-audio-voice-tools", "AI Audio Transcription Tools"],
  zapier: ["ai-office-tools", "AI Office Automation Tools"],
};
// keep the old placement as an extra category, except Midjourney in Marketing (a misfit, approved to drop)
const KEEP_OLD_AS_MEMBERSHIP = new Set(Object.keys(MOVES).filter((s) => s !== "midjourney"));

// ---------------------------------------------------------------- plan
const plan = new Map(); // tool id -> { t, after(state), notes[], url? , urlStatus, redirectTo? }
const get = (t) => {
  if (!plan.has(t.id))
    plan.set(t.id, {
      t,
      after: stateOf(t, []),
      notes: [],
      url: undefined,
      urlStatus: undefined,
      redirectTo: undefined,
    });
  return plan.get(t.id);
};
const report = {
  opId: OP_ID,
  now: NOW,
  copyGroups: 0,
  copiesArchived: 0,
  membershipsAdded: 0,
  redirectsAdded: 0,
  categoryMoves: 0,
  urlUpdated: 0,
  urlStatus: {},
  needsManual: {},
  sameNameDifferentSite: [],
  skipped: [],
};

// 1. category moves first (primaries keep their URL)
for (const [slug, [cat, sub]] of Object.entries(MOVES)) {
  const t = tools.find((x) => x.slug === slug);
  if (!t) {
    report.skipped.push(`move: ${slug} not found`);
    continue;
  }
  if (!cats.get(cat)?.subs.includes(sub)) throw new Error(`invalid target ${cat}/${sub}`);
  const p = get(t);
  if (KEEP_OLD_AS_MEMBERSHIP.has(slug) && t.category_id !== cat)
    p.after.memberships.push({ category_id: t.category_id, subcategory: t.subcategory ?? null });
  p.after.category_id = cat;
  p.after.subcategory = sub;
  p.notes.push(`category ${t.category_id}/${t.subcategory} -> ${cat}/${sub}`);
  report.categoryMoves++;
}

// Same name, different websites: decided one by one (approved audit). Merged groups name their primary; the rest stay
// separate listings and are flagged for a person.
const MANUAL_MERGE = {
  claude: ["claude-anthropic", "claude-coding-developer"], // anthropic.com/claude and claude.ai are the same product
  "zoom-ai-companion": ["zoom-ai-companion-office"], // explore.zoom.us and zoom.us: the same product
};
const MANUAL_REVIEW = {
  "deepcode-snyk-code": "DeepCode became Snyk Code; deepcode.ai may be a different product",
  deepcode: "DeepCode became Snyk Code; deepcode.ai may be a different product",
  "google-optimize": "Google Optimize was discontinued in September 2023",
  "google-optimize-ga4-experiments": "Google Optimize was discontinued in September 2023",
};
// (microsoft-copilot and microsoft-copilot-office are different products: Copilot vs Copilot for Microsoft 365. Kept.)

// 2. cross-category copies
const pub = tools.filter((t) => t.status === "published");
const groups = new Map();
for (const t of pub) groups.set(base(t.name), [...(groups.get(base(t.name)) ?? []), t]);
for (const [name, list] of groups) {
  if (list.length < 2) continue;
  const merge = Object.entries(MANUAL_MERGE).find(([p]) => list.some((t) => t.slug === p));
  if (new Set(list.map((t) => siteOf(t))).size !== 1 && !merge) {
    report.sameNameDifferentSite.push(list.map((t) => `${t.slug}@${siteOf(t)}`).join(", "));
    continue; // different websites and no recorded decision: separate listings
  }
  report.copyGroups++;
  const primary =
    (merge ? list.find((t) => t.slug === merge[0]) : undefined) ??
    list.find((t) => t.indexing === "index") ??
    list.find((t) => t.slug === slugify(name)) ??
    [...list].sort((a, b) => a.slug.length - b.slug.length || a.sort_order - b.sort_order)[0];
  const pp = get(primary);
  for (const c of list) {
    if (c.id === primary.id) continue;
    const cp = get(c);
    const target = pp.after.category_id;
    if (
      c.category_id !== target &&
      !pp.after.memberships.some((m) => m.category_id === c.category_id)
    ) {
      pp.after.memberships.push({ category_id: c.category_id, subcategory: c.subcategory ?? null });
      report.membershipsAdded++;
    }
    cp.after.status = "archived";
    cp.after.indexing = "noindex";
    cp.redirectTo = primary;
    cp.notes.push(
      `duplicate of ${primary.slug}: archived, 301 -> /tools/${primary.slug}, shown on ${c.category_id} through a membership`,
    );
    report.copiesArchived++;
  }
}
// a membership never repeats the primary category
for (const p of plan.values()) {
  const seen = new Set();
  p.after.memberships = p.after.memberships
    .filter(
      (m) =>
        m.category_id !== p.after.category_id &&
        !seen.has(m.category_id) &&
        seen.add(m.category_id),
    )
    .sort((a, b) => a.category_id.localeCompare(b.category_id));
}

// 3. URL status (every tool with a URL that was checked), same-brand URL updates, manual-review flags
const classify = (t) => {
  const r = urls[t.url];
  if (!t.url || !/^https?:\/\//.test(t.url)) return { s: "dead", why: "missing or invalid URL" };
  // a URL updated by an earlier run is not in the check file: keep the status recorded then (re-runs, e.g. after an undo)
  if (!r && t.url_status)
    return t.url_status === "ok" || t.url_status === "blocked"
      ? { s: t.url_status }
      : { s: t.url_status, why: `previously flagged (${t.url_status})` };
  if (!r) return { s: "error", why: "not checked" };
  if (r.status === "ERR")
    return /ENOTFOUND|EAI_AGAIN/.test(r.error)
      ? { s: "dead", why: "domain does not resolve" }
      : { s: "error", why: `connection/TLS error (${r.error})` };
  if (r.status === 404 || r.status === 410) return { s: "dead", why: `page returns ${r.status}` };
  if ([401, 403, 429].includes(r.status)) return { s: "blocked", why: null };
  if (r.status >= 400) return { s: "error", why: `HTTP ${r.status}` };
  const from = host(t.url),
    to = host(r.final ?? t.url);
  if (to && from !== to && label(from) !== label(to)) {
    // checked by hand (approved review): a similar name on another domain that may be a different product
    const NOT_SAME = new Set(["rephrase.ai", "rephrase.info"]);
    if (sameBrand(from, to) && !NOT_SAME.has(from)) {
      const u = new URL(r.final);
      return { s: "ok", newUrl: `${u.origin}${u.pathname}` };
    }
    return { s: "redirect", why: `redirects to another site (${to})` };
  }
  return { s: "ok" };
};
for (const t of tools) {
  if (t.status === "archived") continue;
  const p = get(t);
  if (p.after.status === "archived") continue; // archived copies: nothing else to do
  const c = classify(t);
  p.urlStatus = c.s;
  report.urlStatus[c.s] = (report.urlStatus[c.s] ?? 0) + 1;
  if (c.newUrl && c.newUrl !== t.url) {
    p.url = c.newUrl;
    p.notes.push(`url ${t.url} -> ${c.newUrl}`);
    report.urlUpdated++;
  }
  if (MANUAL_REVIEW[t.slug] && p.after.review_status !== "reviewed") {
    p.after.review_status = "needs_manual";
    p.notes.push(`needs manual review: ${MANUAL_REVIEW[t.slug]}`);
    report.needsManual["product decision"] = (report.needsManual["product decision"] ?? 0) + 1;
  } else if (c.why && p.after.review_status !== "reviewed") {
    p.after.review_status = "needs_manual";
    p.notes.push(`needs manual review: ${c.why}`);
    report.needsManual[c.why.replace(/\(.*\)/, "").trim()] =
      (report.needsManual[c.why.replace(/\(.*\)/, "").trim()] ?? 0) + 1;
  } else if (c.why) p.notes.push(`reviewed tool, URL issue noted: ${c.why}`);
}

// ---------------------------------------------------------------- SQL
const q = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sql = [
  `-- Preview catalogue cleanup, generated ${new Date().toISOString()} from ${snapshot}. Bulk operation ${OP_ID}.`,
  "-- Undo: Admin > Tools > Recent bulk operations > Undo. Redirect rows: DELETE FROM tool_redirects WHERE created_at = " +
    q(NOW) +
    ";",
  `INSERT INTO bulk_operations (id, actor_email, action, summary, total, status, created_at, updated_at) VALUES (${q(OP_ID)}, ${q(ACTOR)}, 'catalogue_cleanup', 'Duplicate consolidation, category corrections and URL checks (approved preview cleanup)', 0, 'running', ${q(NOW)}, ${q(NOW)});`,
];
const csv = [["slug", "name", "changes"].join(",")];
let items = 0;
for (const p of plan.values()) {
  const t = p.t;
  const before = stateOf(t, []);
  const changed = !same(before, p.after) || p.url !== undefined || p.urlStatus !== undefined;
  if (!changed) continue;
  const sets = [];
  for (const k of [
    "category_id",
    "subcategory",
    "indexing",
    "status",
    "review_status",
    "needs_review",
    "pricing_model",
  ])
    if (!same(before[k], p.after[k])) sets.push(`${k} = ${q(p.after[k])}`);
  if (p.url !== undefined) sets.push(`url = ${q(p.url)}`);
  if (p.urlStatus !== undefined)
    sets.push(`url_status = ${q(p.urlStatus)}, url_checked_at = ${q(NOW)}`);
  if (p.notes.length) sets.push(`review_notes = ${q(p.notes.join(" | ").slice(0, 1000))}`);
  sets.push(`updated_at = ${q(NOW)}`);
  sql.push(
    `UPDATE tools SET ${sets.join(", ")} WHERE id = ${q(t.id)} AND updated_at = ${q(t.updated_at)};`,
  );
  for (const [i, m] of p.after.memberships.entries())
    sql.push(
      `INSERT INTO tool_categories (tool_id, category_id, subcategory, sort_order, created_at) VALUES (${q(t.id)}, ${q(m.category_id)}, ${q(m.subcategory)}, ${i}, ${q(NOW)});`,
    );
  if (p.redirectTo) {
    sql.push(
      `INSERT OR IGNORE INTO tool_redirects (old_slug, tool_id, created_at) VALUES (${q(t.slug)}, ${q(p.redirectTo.id)}, ${q(NOW)});`,
    );
    report.redirectsAdded++;
  }
  if (!same(before, p.after)) {
    sql.push(
      `INSERT INTO bulk_operation_items (op_id, tool_id, slug, before, after) VALUES (${q(OP_ID)}, ${q(t.id)}, ${q(t.slug)}, ${q(JSON.stringify(before))}, ${q(JSON.stringify(p.after))});`,
    );
    items++;
  }
  sql.push(
    `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(NOW)}, ${q(ACTOR)}, 'tool.cleanup', 'tool', ${q(t.slug)}, ${q((p.notes.join("; ") || `url status ${p.urlStatus}`).slice(0, 200))});`,
  );
  csv.push(
    [
      t.slug,
      `"${t.name.replace(/"/g, '""')}"`,
      `"${(p.notes.join(" | ") || `url status: ${p.urlStatus}`).replace(/"/g, '""')}"`,
    ].join(","),
  );
}
sql.push(
  `UPDATE bulk_operations SET total = ${items}, applied = ${items}, status = 'done', updated_at = ${q(NOW)} WHERE id = ${q(OP_ID)};`,
);
sql.push(
  `INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', ${q(`${NOW}#${OP_ID}`)}, ${q(NOW)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
);
report.toolsUpdated = csv.length - 1;
report.undoableItems = items;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "cleanup.sql"), sql.join("\n") + "\n");
writeFileSync(join(out, "cleanup-changes.csv"), csv.join("\n") + "\n");

// ---------------------------------------------------------------- rehearsal on the local copy + invariants
db.exec("PRAGMA foreign_keys = ON;");
db.exec(sql.join("\n"));
const one = (s) => db.query(s).get();
const inv = {
  integrity: one("PRAGMA integrity_check").integrity_check,
  fkViolations: db.query("PRAGMA foreign_key_check").all().length,
  allUpdatesApplied:
    one(`SELECT count(*) n FROM tools WHERE updated_at = ${q(NOW)}`).n === report.toolsUpdated,
  publishedDuplicateCopiesLeft: (() => {
    const g = new Map();
    for (const t of db
      .query("SELECT id, slug, name, url, category_id FROM tools WHERE status='published'")
      .all()) {
      if (["microsoft copilot", "deepcode", "google optimize"].includes(base(t.name))) continue;
      const k = base(t.name) + "|" + siteOf(t);
      g.set(k, (g.get(k) ?? 0) + 1);
    }
    return [...g.values()].filter((n) => n > 1).length;
  })(),
  redirectsResolveToPublishedPrimary:
    one(
      `SELECT count(*) n FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE t.status = 'published'`,
    ).n === report.redirectsAdded,
  redirectSlugsAreArchived:
    one(
      `SELECT count(*) n FROM tool_redirects r JOIN tools o ON o.slug = r.old_slug WHERE o.status <> 'archived'`,
    ).n === 0,
  membershipsValid:
    one(
      `SELECT count(*) n FROM tool_categories m JOIN categories c ON c.id = m.category_id WHERE m.subcategory IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(c.subcategories) WHERE value = m.subcategory)`,
    ).n === 0,
  membershipNeverPrimary:
    one(
      `SELECT count(*) n FROM tool_categories m JOIN tools t ON t.id = m.tool_id WHERE m.category_id = t.category_id`,
    ).n === 0,
  indexedUnchanged: one("SELECT count(*) n FROM tools WHERE indexing='index'").n,
  publishedAfter: one("SELECT count(*) n FROM tools WHERE status='published'").n,
  archivedAfter: one("SELECT count(*) n FROM tools WHERE status='archived'").n,
  membershipsAfter: one("SELECT count(*) n FROM tool_categories").n,
  reviewStatus: db.query("SELECT review_status s, count(*) n FROM tools GROUP BY 1").all(),
  categoryCardCounts: db
    .query(
      `SELECT c.slug, (SELECT count(*) FROM tools t WHERE t.category_id=c.id AND t.status='published') + (SELECT count(*) FROM tool_categories m JOIN tools t ON t.id=m.tool_id WHERE m.category_id=c.id AND t.status='published') AS cards FROM categories c ORDER BY c.sort_order`,
    )
    .all(),
};
report.rehearsal = inv;
writeFileSync(join(out, "cleanup-report.json"), JSON.stringify(report, null, 1));
console.log(
  JSON.stringify(
    { ...report, sameNameDifferentSite: report.sameNameDifferentSite.length },
    null,
    1,
  ),
);
const bad =
  !inv.allUpdatesApplied ||
  inv.publishedDuplicateCopiesLeft ||
  !inv.redirectsResolveToPublishedPrimary ||
  !inv.redirectSlugsAreArchived ||
  !inv.membershipsValid ||
  !inv.membershipNeverPrimary ||
  inv.integrity !== "ok" ||
  inv.fkViolations;
if (bad) {
  console.error("REHEARSAL FAILED: see invariants above. Do not apply.");
  process.exit(1);
}
console.log("REHEARSAL OK");

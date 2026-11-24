// Generates the guarded SQL that brings production's catalogue up to the verified preview state, plus its exact rollback.
// It never copies the preview database wholesale: only tools, tool_categories, tool_redirects, tool_review_history and the
// preview's audit rows written after the split are synced. News, categories, media, content sections and settings are
// left untouched. Every tool UPDATE is guarded by the production row's updated_at in the snapshot it was generated from,
// so a row edited on production since then is skipped (and reported by the rehearsal's change count).
//
// usage: bun scripts/db/sync-to-production.mjs --prod <prod export or .sqlite> --preview <preview export or .sqlite>
//          --since-audit-id <last preview audit id that production already has an equivalent of> --out <dir>
// Writes <out>/sync.sql, <out>/sync-rollback.sql, <out>/sync-report.json and rehearses both on local copies.
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PROD = arg("--prod"),
  PREV = arg("--preview"),
  OUT = arg("--out"),
  SINCE = Number(arg("--since-audit-id"));
if (!PROD || !PREV || !OUT || !Number.isInteger(SINCE)) {
  console.error("missing --prod/--preview/--out/--since-audit-id");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const open = (src, name) => {
  if (src.endsWith(".sqlite")) return new Database(src, { readonly: true });
  const f = join(OUT, name);
  if (existsSync(f)) rmSync(f);
  const d = new Database(f);
  d.exec("PRAGMA foreign_keys=OFF;");
  d.exec(readFileSync(src, "utf8"));
  return d;
};
const prod = open(PROD, "prod.sqlite"),
  prev = open(PREV, "preview.sqlite");
const lit = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number" || typeof v === "bigint"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const env = (d) => d.query("SELECT value FROM meta WHERE key='environment'").get()?.value;
if (env(prod) !== "production" || env(prev) !== "preview") {
  console.error("meta.environment mismatch");
  process.exit(2);
}
if (!prev.query("SELECT 1 FROM sqlite_master WHERE name='tool_review_history'").get()) {
  console.error("preview lacks 0011");
  process.exit(2);
}

const fwd = [],
  back = [];
const now = new Date().toISOString();
const ACTOR = "release@tryaitools.io";

// 1. tools: every differing column, guarded by production updated_at.
const cols = prod
  .query("PRAGMA table_info(tools)")
  .all()
  .map((r) => r.name)
  .filter((c) => c !== "id");
const P = new Map(
  prod
    .query("SELECT * FROM tools")
    .all()
    .map((r) => [r.id, r]),
);
const V = new Map(
  prev
    .query("SELECT * FROM tools")
    .all()
    .map((r) => [r.id, r]),
);
if (P.size !== V.size || [...P.keys()].some((k) => !V.has(k))) {
  console.error("tool ids differ between snapshots");
  process.exit(2);
}
// --prod-base <older production snapshot>: columns an editor changed on production since that snapshot keep the
// production value (e.g. affiliate URLs set in the live Admin); every other column comes from the preview.
const keptEdits = [];
if (arg("--prod-base")) {
  const base = open(arg("--prod-base"), "prod-base.sqlite");
  for (const b of base.query("SELECT * FROM tools").all()) {
    const p = P.get(b.id);
    if (!p || p.updated_at === b.updated_at) continue;
    const owned = cols.filter((c) => c !== "updated_at" && b[c] !== p[c]);
    const v = V.get(b.id);
    const t = { ...v };
    for (const c of owned) t[c] = p[c];
    t.updated_at = p.updated_at > v.updated_at ? p.updated_at : v.updated_at;
    V.set(b.id, t);
    keptEdits.push({ slug: p.slug, kept: Object.fromEntries(owned.map((c) => [c, p[c]])) });
  }
}
let toolUpdates = 0;
const colCount = {};
for (const [id, p] of P) {
  const v = V.get(id);
  const diff = cols.filter((c) => p[c] !== v[c]);
  if (!diff.length) continue;
  toolUpdates++;
  for (const c of diff) colCount[c] = (colCount[c] ?? 0) + 1;
  fwd.push(
    `UPDATE tools SET ${diff.map((c) => `${c} = ${lit(v[c])}`).join(", ")} WHERE id = ${lit(id)} AND updated_at = ${lit(p.updated_at)};`,
  );
  back.push(
    `UPDATE tools SET ${diff.map((c) => `${c} = ${lit(p[c])}`).join(", ")} WHERE id = ${lit(id)} AND updated_at = ${lit(v.updated_at)};`,
  );
}

// 2. tool_categories: make production's set equal the preview's.
const key = (r) => `${r.tool_id}|${r.category_id}`;
const PC = new Map(
  prod
    .query("SELECT * FROM tool_categories")
    .all()
    .map((r) => [key(r), r]),
);
const VC = new Map(
  prev
    .query("SELECT * FROM tool_categories")
    .all()
    .map((r) => [key(r), r]),
);
const ins = (t, r) =>
  `INSERT INTO ${t} (${Object.keys(r).join(", ")}) VALUES (${Object.values(r).map(lit).join(", ")});`;
let memAdd = 0,
  memDel = 0,
  memUpd = 0;
for (const [k, r] of VC) {
  const p = PC.get(k);
  if (!p) {
    memAdd++;
    fwd.push(ins("tool_categories", r));
    back.push(
      `DELETE FROM tool_categories WHERE tool_id = ${lit(r.tool_id)} AND category_id = ${lit(r.category_id)};`,
    );
  } else if (p.subcategory !== r.subcategory || p.sort_order !== r.sort_order) {
    memUpd++;
    fwd.push(
      `UPDATE tool_categories SET subcategory = ${lit(r.subcategory)}, sort_order = ${r.sort_order} WHERE tool_id = ${lit(r.tool_id)} AND category_id = ${lit(r.category_id)};`,
    );
    back.push(
      `UPDATE tool_categories SET subcategory = ${lit(p.subcategory)}, sort_order = ${p.sort_order} WHERE tool_id = ${lit(r.tool_id)} AND category_id = ${lit(r.category_id)};`,
    );
  }
}
for (const [k, r] of PC)
  if (!VC.has(k)) {
    memDel++;
    fwd.push(
      `DELETE FROM tool_categories WHERE tool_id = ${lit(r.tool_id)} AND category_id = ${lit(r.category_id)};`,
    );
    back.push(ins("tool_categories", r));
  }

// 3. tool_redirects: add new rows, re-point changed ones. Production-only rows are kept as they are.
const PR = new Map(
  prod
    .query("SELECT * FROM tool_redirects")
    .all()
    .map((r) => [r.old_slug, r]),
);
const VR = new Map(
  prev
    .query("SELECT * FROM tool_redirects")
    .all()
    .map((r) => [r.old_slug, r]),
);
let redAdd = 0,
  redRepoint = 0;
const prodOnlyRedirects = [...PR.keys()].filter((k) => !VR.has(k));
for (const [k, r] of VR) {
  const p = PR.get(k);
  if (!p) {
    redAdd++;
    fwd.push(ins("tool_redirects", r));
    back.push(`DELETE FROM tool_redirects WHERE old_slug = ${lit(k)};`);
  } else if (p.tool_id !== r.tool_id) {
    redRepoint++;
    fwd.push(
      `UPDATE tool_redirects SET tool_id = ${lit(r.tool_id)} WHERE old_slug = ${lit(k)} AND tool_id = ${lit(p.tool_id)};`,
    );
    back.push(
      `UPDATE tool_redirects SET tool_id = ${lit(p.tool_id)} WHERE old_slug = ${lit(k)} AND tool_id = ${lit(r.tool_id)};`,
    );
  }
}

// 4. tool_review_history (new in 0011, empty on production): copy with ids.
const hist = prev.query("SELECT * FROM tool_review_history ORDER BY id").all();
const prodHist = prod.query("SELECT 1 FROM sqlite_master WHERE name='tool_review_history'").get()
  ? prod.query("SELECT count(*) n FROM tool_review_history").get().n
  : 0;
if (prodHist) {
  console.error("production tool_review_history is not empty");
  process.exit(2);
}
for (const r of hist) fwd.push(ins("tool_review_history", r));
back.push("DELETE FROM tool_review_history;");

// 5. audit_events written on preview after the split (sitemap lastmod and the change log depend on them), new ids.
const prodMaxAudit = prod.query("SELECT max(id) m FROM audit_events").get().m;
const aud = prev
  .query(
    "SELECT at, actor_email, action, entity_type, entity_id, summary FROM audit_events WHERE id > ? ORDER BY id",
  )
  .all(SINCE);
for (const r of aud) fwd.push(ins("audit_events", r));
fwd.push(
  ins("audit_events", {
    at: now,
    actor_email: ACTOR,
    action: "catalog.release_sync",
    entity_type: "catalog",
    entity_id: null,
    summary: `production release: ${toolUpdates} tools synced from verified preview`,
  }),
);
back.push(`DELETE FROM audit_events WHERE id > ${prodMaxAudit};`);

// 6. bump the catalogue version so the gate re-checks every static page against the database.
const oldVer = prod.query("SELECT value, updated_at FROM meta WHERE key='catalog_version'").get();
fwd.push(
  `UPDATE meta SET value = ${lit(`${now}#release-sync`)}, updated_at = ${lit(now)} WHERE key = 'catalog_version';`,
);
back.push(
  `UPDATE meta SET value = ${lit(oldVer.value)}, updated_at = ${lit(oldVer.updated_at)} WHERE key = 'catalog_version';`,
);

writeFileSync(join(OUT, "sync.sql"), fwd.join("\n") + "\n");
writeFileSync(join(OUT, "sync-rollback.sql"), back.reverse().join("\n") + "\n");

// Rehearsal: apply to a copy of production (after 0011), compare with preview; then roll back and compare with production.
const copy = join(OUT, "rehearsal.sqlite");
if (existsSync(copy)) rmSync(copy);
prod.exec(`VACUUM INTO '${copy.replace(/\\/g, "/").replace(/'/g, "''")}'`);
const r = new Database(copy);
if (!r.query("SELECT 1 FROM sqlite_master WHERE name='tool_review_history'").get())
  r.exec(
    readFileSync(new URL("../../migrations/0011_review_history.sql", import.meta.url), "utf8"),
  );
r.exec("PRAGMA foreign_keys=ON;");
const changesBefore = r.query("SELECT total_changes() c").get().c;
r.exec(fwd.join("\n"));
const applied = r.query("SELECT total_changes() c").get().c - changesBefore;
const dump = (d, sql) => JSON.stringify(d.query(sql).all());
const same = (a, b, sql) => dump(a, sql) === dump(b, sql);
const T = "SELECT * FROM tools ORDER BY id",
  C = "SELECT tool_id, category_id, subcategory, sort_order FROM tool_categories ORDER BY 1,2",
  R = "SELECT old_slug, tool_id FROM tool_redirects ORDER BY 1",
  H = "SELECT * FROM tool_review_history ORDER BY id";
const check = {
  // tools must equal the target: the preview row, with editor changes made on production kept (--prod-base)
  toolsEqualTarget:
    dump(r, T) === JSON.stringify([...V.values()].sort((a, b) => (a.id < b.id ? -1 : 1))),
  membershipsEqualPreview: same(r, prev, C),
  redirectsEqualPreviewPlusProdOnly:
    dump(
      r,
      `SELECT old_slug, tool_id FROM tool_redirects WHERE old_slug NOT IN (${prodOnlyRedirects.map(lit).join(",") || "''"}) ORDER BY 1`,
    ) === dump(prev, R),
  historyEqualPreview: same(r, prev, H),
  newsUntouched:
    same(r, prod, "SELECT * FROM news_articles ORDER BY id") &&
    same(r, prod, "SELECT * FROM news_sources ORDER BY id"),
  categoriesUntouched: same(r, prod, "SELECT * FROM categories ORDER BY id"),
  integrity: r.query("PRAGMA integrity_check").get().integrity_check,
  fkViolations: r.query("PRAGMA foreign_key_check").all().length,
  // redirects to a draft (dead listing) answer 404 like the listing itself; one to an archived copy would be a broken merge
  redirectsToArchived: r
    .query(
      "SELECT count(*) n FROM tool_redirects x JOIN tools t ON t.id = x.tool_id WHERE t.status = 'archived'",
    )
    .get().n,
  indexedNotPublished: r
    .query("SELECT count(*) n FROM tools WHERE indexing='index' AND status <> 'published'")
    .get().n,
  expectedChanges: fwd.length,
  applied,
  allStatementsApplied: applied === fwd.length,
};
r.exec(back.join("\n"));
check.rollbackRestoresTools = same(r, prod, T);
check.rollbackRestoresMemberships = same(r, prod, C);
check.rollbackRestoresRedirects = same(r, prod, R);
check.rollbackRestoresAudit = same(r, prod, "SELECT * FROM audit_events ORDER BY id");
check.rollbackRestoresMeta = same(r, prod, "SELECT * FROM meta ORDER BY key");
r.close();
rmSync(copy);

const counts = (d) => ({
  byStatus: d.query("SELECT status, count(*) n FROM tools GROUP BY 1 ORDER BY 1").all(),
  indexed: d.query("SELECT count(*) n FROM tools WHERE indexing='index'").get().n,
  redirects: d.query("SELECT count(*) n FROM tool_redirects").get().n,
  memberships: d.query("SELECT count(*) n FROM tool_categories").get().n,
});
const report = {
  generatedAt: now,
  prod: PROD,
  preview: PREV,
  sinceAuditId: SINCE,
  toolUpdates,
  colCount,
  memAdd,
  memDel,
  memUpd,
  redAdd,
  redRepoint,
  prodOnlyRedirects,
  keptEdits,
  historyRows: hist.length,
  auditRows: aud.length + 1,
  before: counts(prod),
  after: counts(prev),
  check,
};
writeFileSync(join(OUT, "sync-report.json"), JSON.stringify(report, null, 1));
console.log(
  JSON.stringify(
    {
      toolUpdates,
      memAdd,
      memDel,
      memUpd,
      redAdd,
      redRepoint,
      prodOnlyRedirects: prodOnlyRedirects.length,
      keptEdits: keptEdits.length,
      historyRows: hist.length,
      auditRows: aud.length + 1,
      check,
    },
    null,
    1,
  ),
);
const ok = Object.entries(check).every(([k, v]) =>
  k === "expectedChanges" || k === "applied"
    ? true
    : k === "integrity"
      ? v === "ok"
      : typeof v === "number"
        ? v === 0
        : v === true,
);
if (!ok) {
  console.error("REHEARSAL FAILED");
  process.exit(1);
}
console.log("REHEARSAL OK");

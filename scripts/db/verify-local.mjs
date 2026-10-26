#!/usr/bin/env node
// Applies migrations + the generated import to an in-memory SQLite database (D1 is SQLite) and checks it.
//   node scripts/db/build-import.mjs --env local && node scripts/db/verify-local.mjs
// Needs Node >= 22.5 (node:sqlite). Touches no Cloudflare resource.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assignSlugs } from "./slugs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, process.argv[2] ?? "db/import/out");
const report = JSON.parse(readFileSync(resolve(outDir, "report.json"), "utf8"));
const data = JSON.parse(readFileSync(resolve(root, "src/data/tools.json"), "utf8"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
const run = (f) => db.exec(readFileSync(f, "utf8"));
const one = (sql, ...p) => db.prepare(sql).get(...p);
const migs = readdirSync(resolve(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
migs.forEach((m) => run(resolve(root, "migrations", m)));
check("migrations apply cleanly", true, migs.join(", "));
const importFiles = () => report.generatedFiles.map((f) => resolve(outDir, f));
importFiles().forEach(run);

const cnt = (t, w = "1") => one(`SELECT count(*) c FROM ${t} WHERE ${w}`).c;
check("category count", cnt("categories") === data.categories.length, `${cnt("categories")} / ${data.categories.length}`);
check("tool count", cnt("tools") === data.tools.length, `${cnt("tools")} / ${data.tools.length}`);
check("flagged rows are draft + needs_review", cnt("tools", "needs_review=1 AND status='draft'") === report.expected.flagged && cnt("tools", "needs_review=1") === 9, `${cnt("tools", "needs_review=1")} flagged`);
check("flagged rows are hidden (none published)", cnt("tools", "needs_review=1 AND status='published'") === 0);
check("published count", cnt("tools", "status='published'") === report.expected.published, `${cnt("tools", "status='published'")}`);
check("no tool without a valid category (FK)", db.prepare("PRAGMA foreign_key_check").all().length === 0);
check("every tool has a category row", cnt("tools t LEFT JOIN categories c ON c.id=t.category_id", "c.id IS NULL") === 0);
check("slugs unique", one("SELECT count(DISTINCT slug) c FROM tools").c === data.tools.length);
const expectedSlugs = assignSlugs(data.tools, data.categories);
const dbSlugs = new Set(db.prepare("SELECT slug FROM tools").all().map((r) => r.slug));
check("slug set equals the site's current slugs", expectedSlugs.every((s) => dbSlugs.has(s)) && dbSlugs.size === expectedSlugs.length);
check("original JSON order preserved in slugs", db.prepare("SELECT slug FROM tools ORDER BY sort_order").all().every((r, i) => r.slug === expectedSlugs[i]));
check("chatgpt / claude / grammarly slugs present", ["chatgpt", "claude", "grammarly"].every((s) => dbSlugs.has(s)));
check("duplicate-name tools keep suffixed slugs and stay noindex", dbSlugs.has("canva-design-ui-ux") && dbSlugs.has("chatgpt-openai") && one("SELECT indexing i FROM tools WHERE slug='canva-design-ui-ux'").i === "noindex");
check("27 indexable tools", cnt("tools", "indexing='index'") === 27, `${cnt("tools", "indexing='index'")}`);
check("curated content filled", cnt("tools", "tagline IS NOT NULL") === report.expected.curatedRows, `${cnt("tools", "tagline IS NOT NULL")}`);
check("environment marker set", one("SELECT value v FROM meta WHERE key='environment'").v === report.env, report.env);
check("admin_users empty (no seeded credentials)", cnt("admin_users") === 0);
for (const f of ["features", "pros", "limits", "steps", "tips"]) {
  const bad = db.prepare(`SELECT id FROM tools WHERE ${f} IS NOT NULL AND json_type(${f}) <> 'array'`).all();
  if (bad.length) check(`${f} is a JSON array`, false);
}
check("JSON columns are arrays", true);

// Idempotency: re-run the import after an admin edit; counts unchanged, edit preserved.
db.exec("UPDATE tools SET tagline='EDITED BY ADMIN', content_source='admin' WHERE slug='chatgpt'");
db.exec("UPDATE tools SET name='Renamed', status='archived' WHERE slug='grammarly'");
importFiles().forEach(run);
check("re-import creates no duplicates", cnt("tools") === data.tools.length && cnt("categories") === data.categories.length);
check("re-import does not overwrite admin edits", one("SELECT tagline t FROM tools WHERE slug='chatgpt'").t === "EDITED BY ADMIN" && one("SELECT name n, status s FROM tools WHERE slug='grammarly'").n === "Renamed");

// Constraints
check("cannot delete a category that still has tools", throws(() => db.exec("DELETE FROM categories WHERE id='ai-writing-tools'")));
check("duplicate slug rejected", throws(() => db.exec("INSERT INTO tools (id,slug,name,category_id) VALUES ('x1','chatgpt','X','ai-writing-tools')")));
check("invalid slug rejected", throws(() => db.exec("INSERT INTO tools (id,slug,name,category_id) VALUES ('x2','Bad Slug!','X','ai-writing-tools')")));
check("invalid status rejected", throws(() => db.exec("INSERT INTO tools (id,slug,name,category_id,status) VALUES ('x3','x3','X','ai-writing-tools','live')")));
check("unknown category rejected", throws(() => db.exec("INSERT INTO tools (id,slug,name,category_id) VALUES ('x4','x4','X','nope')")));
check("non-lowercase admin email rejected", throws(() => db.exec("INSERT INTO admin_users (email,role) VALUES ('A@B.com','owner')")));
check("redirect cascades with tool", (() => {
  db.exec("INSERT INTO tool_redirects (old_slug,tool_id) SELECT 'old-chatgpt', id FROM tools WHERE slug='chatgpt'");
  db.exec("DELETE FROM tools WHERE slug='chatgpt'");
  return cnt("tool_redirects") === 0;
})());

// Rollback
db.exec(readFileSync(resolve(root, "db/rollback/0001_core.down.sql"), "utf8"));
check("rollback drops every table", db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length === 0);
migs.forEach((m) => run(resolve(root, "migrations", m)));
check("migration re-applies after rollback", cnt("tools") === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

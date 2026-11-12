#!/usr/bin/env bun
// Generates (does NOT run) SQL that stores the category landing copy (db/content/category-landing.json) in the PREVIEW
// database: seo_title, seo_description, intro and faqs for each category, with one audit row each and a catalogue
// version bump. Only those four columns change; a category whose slug is unknown is reported, never created.
//   bun scripts/db/category-landing.mjs --snapshot <export.sql> --out <file.sql>
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const out = arg("--out");
if (!snapshot || !out) {
  console.error(
    "Usage: bun scripts/db/category-landing.mjs --snapshot <export.sql> --out <file.sql>",
  );
  process.exit(2);
}
const content = JSON.parse(readFileSync("db/content/category-landing.json", "utf8"));
const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
const now = new Date().toISOString();
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const problems = [];
const sql = [];
const seenTitles = new Set();
const seenDescs = new Set();
for (const [slug, c] of Object.entries(content)) {
  if (slug.startsWith("_")) continue;
  const row = db.query("SELECT id, updated_at FROM categories WHERE slug = ?").get(slug);
  if (!row) {
    problems.push(`unknown category ${slug}`);
    continue;
  }
  const check = (cond, msg) => cond || problems.push(`${slug}: ${msg}`);
  check(c.seo_title.length <= 60, `seo_title ${c.seo_title.length} chars`);
  check(
    c.seo_description.length >= 120 && c.seo_description.length <= 160,
    `seo_description ${c.seo_description.length} chars`,
  );
  check(c.intro.length <= 3000 && c.intro.split(/\s+/).length >= 60, "intro length");
  check(Array.isArray(c.faqs) && c.faqs.length >= 2 && c.faqs.length <= 10, "faqs");
  check(!seenTitles.has(c.seo_title), "duplicate title");
  check(!seenDescs.has(c.seo_description), "duplicate description");
  seenTitles.add(c.seo_title);
  seenDescs.add(c.seo_description);
  sql.push(
    `UPDATE categories SET seo_title = ${q(c.seo_title)}, seo_description = ${q(c.seo_description)}, intro = ${q(c.intro)}, faqs = ${q(JSON.stringify(c.faqs))}, updated_at = ${q(now)} WHERE id = ${q(row.id)} AND updated_at = ${q(row.updated_at)};`,
    `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (${q(now)}, 'category-landing-script (approved preview category SEO)', 'category.update', 'category', ${q(slug)}, 'Category landing copy: SEO title, description, intro and FAQs');`,
  );
}
sql.push(
  `INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', ${q(`${now}#category-landing`)}, ${q(now)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
);
if (problems.length) {
  console.error("NOT WRITTEN:\n" + problems.join("\n"));
  process.exit(1);
}
// rehearse
db.exec(sql.join("\n"));
const n = db.query("SELECT count(*) n FROM categories WHERE intro IS NOT NULL").get().n;
writeFileSync(out, sql.join("\n") + "\n");
console.log(`OK: ${n} categories get landing copy; SQL written to ${out}`);

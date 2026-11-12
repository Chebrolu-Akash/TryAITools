#!/usr/bin/env node
// Pre-renders the public site to static HTML from a D1 snapshot, using the BUILT Worker itself (so the HTML is exactly
// what the server would render: same markup, metadata, canonical URLs, structured data).
//
//   node scripts/static/prerender.mjs --snapshot <file.sql | file.sqlite>
//
// --snapshot: a `wrangler d1 export` SQL file (e.g. from `bun scripts/db/preview-d1.mjs backup`) or the local D1 SQLite
// file. Nothing remote is contacted. Requires Node >= 22.5 (node:sqlite) and `bun run build && bun scripts/static/build-gate.mjs`.
//
// Safety: pages are rendered into a staging folder and checked (status, canonical, title, no link to a non-public tool).
// Only if every check passes are the previous build's pages removed from .output/public and the new ones moved in, together
// with /_static/build.json, the reverse index /_static/refs/{t,c}/<slug>.json, the sitemap (sitemap.xml and
// /_static/sitemap.json) and the search index /_static/search.json used by the gate. On any failure nothing in
// .output/public changes and the script exits non-zero, so a deploy step that follows it never runs.
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
// Plain TypeScript modules shared with the gate (Node strips their type annotations; they have no runtime imports).
import { SEARCH_INDEX_PATH, searchIndexFromDb } from "../../src/static/search.ts";
import { SITEMAP_DATA_PATH, sitemapFiles, sitemapFromDb } from "../../src/static/sitemap.ts";

const SITE = "https://tryaitools.io";
const STATIC_PAGES = [
  "/",
  "/tools",
  "/categories",
  "/about",
  "/privacy",
  "/terms",
  "/affiliate-disclosure",
  "/how-we-review",
  "/agents",
  "/learn",
  "/learn/courses",
  "/learn/books",
  "/learn/tutorials",
  "/gadgets",
  "/guest-articles",
  "/blog",
  "/news",
];
// AI News category pages are always pre-rendered (noindex while empty); keep in sync with src/lib/news/model.ts.
const NEWS_CATEGORIES = [
  "model-releases",
  "tool-launches",
  "company-news",
  "research",
  "business-funding",
  "regulation-policy",
];
const NOT_FOUND_PROBE = "/tools/zz-static-not-found-probe";
const PUBLIC =
  "t.status = 'published' AND t.needs_review = 0 AND t.category_id IN (SELECT id FROM categories WHERE status = 'published')";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const out = resolve(arg("--out") ?? ".output");
const fail = (msg) => {
  console.error(`prerender FAILED: ${msg}\nNothing in ${join(out, "public")} was changed.`);
  process.exit(1);
};
if (!snapshot || !existsSync(snapshot)) fail("pass --snapshot <export.sql | d1.sqlite>");
if (!existsSync(join(out, "server/gate.mjs")))
  fail("run `bun run build && bun scripts/static/build-gate.mjs` first");

// ------------------------------------------------------------------ snapshot -> SQLite (in memory)
const raw = new DatabaseSync(":memory:");
// A copy of a snapshot, never written by rendering: tables are copied in any order, so references (e.g. to media) are
// not enforced while copying.
raw.exec("PRAGMA foreign_keys = OFF");
if (snapshot.endsWith(".sql")) {
  raw.exec(readFileSync(snapshot, "utf8"));
} else {
  // A D1 SQLite file (e.g. the local Miniflare database): copy its tables into memory, never write to it.
  raw.exec(`ATTACH DATABASE '${resolve(snapshot).replaceAll("'", "''")}' AS src`);
  const tables = raw
    .prepare(
      "SELECT name, sql FROM src.sqlite_master WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all();
  for (const { name, sql } of tables) {
    raw.exec(sql);
    raw.exec(`INSERT INTO main."${name}" SELECT * FROM src."${name}"`);
  }
  raw.exec("DETACH DATABASE src");
}
const one = (sql) => raw.prepare(sql).get();
const snapshotVersion = String(
  one("SELECT value FROM meta WHERE key = 'catalog_version'")?.value ?? "",
);
const snapshotAt = String(
  one(`SELECT max(x) AS at FROM (
         SELECT max(updated_at) AS x FROM tools UNION ALL SELECT max(updated_at) FROM categories
         UNION ALL SELECT max(at) FROM audit_events UNION ALL SELECT max(updated_at) FROM meta)`)
    ?.at ?? "",
);
const publicTools = new Set(
  raw
    .prepare(`SELECT t.slug FROM tools t WHERE ${PUBLIC}`)
    .all()
    .map((r) => r.slug),
);
const publicCategories = raw
  .prepare("SELECT slug FROM categories WHERE status = 'published' ORDER BY sort_order, name")
  .all()
  .map((r) => r.slug);
if (publicTools.size === 0) fail("the snapshot has no public tools");
// Content sections: every published entry gets a page. A database without the tables (before migration 0004) has none.
const contentVersion = String(
  one("SELECT value FROM meta WHERE key = 'content_version'")?.value ?? "",
);
// [URL prefix, table, canonical column, extra condition]
const CONTENT_TABLES = [
  ["learn/courses", "courses", "NULL", "kind = 'course'"],
  ["learn/books", "courses", "NULL", "kind = 'book'"],
  ["learn/tutorials", "tutorials", "NULL", "1"],
  ["gadgets", "gadgets", "NULL", "1"],
  ["guest-articles", "guest_articles", "canonical_url", "1"],
  ["blog", "blog_posts", "canonical_url", "1"],
];
const contentPaths = [];
/** Pages whose canonical is another URL (a republished article): expected canonical, and not listed in the sitemap. */
const otherCanonical = new Map();
for (const [section, table, canonical, where] of CONTENT_TABLES) {
  let list = [];
  try {
    list = raw
      .prepare(
        `SELECT slug, ${canonical} AS canonical FROM ${table} WHERE status = 'published' AND ${where} ORDER BY slug`,
      )
      .all();
  } catch (e) {
    if (!/no such (table|column)/i.test(String(e?.message ?? e))) throw e;
  }
  for (const r of list) {
    const path = `/${section}/${r.slug}`;
    contentPaths.push(path);
    if (r.canonical && r.canonical !== SITE + path) otherCanonical.set(path, r.canonical);
  }
}

// AI News: every published article (a database without migration 0009 has none). The gate serves these files only while
// meta.news_version still equals the snapshot's; after the next ingestion run the app renders /news live.
const newsVersion = String(one("SELECT value FROM meta WHERE key = 'news_version'")?.value ?? "");
let newsPaths = [];
try {
  newsPaths = raw
    .prepare("SELECT slug FROM news_articles WHERE status = 'published' ORDER BY slug")
    .all()
    .map((r) => `/news/${r.slug}`);
} catch (e) {
  if (!/no such (table|column)/i.test(String(e?.message ?? e))) throw e;
}
contentPaths.push(...NEWS_CATEGORIES.map((c) => `/news/category/${c}`), ...newsPaths);

// ------------------------------------------------------------------ the built Worker, against the snapshot
const stmt = (sql, params = []) => ({
  bind: (...p) => stmt(sql, p),
  first: async () => raw.prepare(sql).get(...params) ?? null,
  all: async () => ({ success: true, results: raw.prepare(sql).all(...params) }),
  run: async () => ({ success: true, meta: { changes: 0 } }), // read-only: rendering never writes
});
const DB = {
  prepare: (sql) => stmt(sql),
  batch: async () => {
    throw new Error("read-only snapshot");
  },
};
globalThis.__CF_ENV__ = { DB };
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === "cloudflare:workers"
      ? {
          url: "data:text/javascript,export const env = globalThis.__CF_ENV__;",
          shortCircuit: true,
        }
      : next(spec, ctx),
});
const app = (await import(pathToFileURL(join(out, "server/index.mjs")).href)).default;
const env = { DB, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const render = async (path) => {
  const res = await app.fetch(new Request(SITE + path), env, ctx);
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
};

// ------------------------------------------------------------------ render + validate
const paths = [
  ...STATIC_PAGES,
  ...publicCategories.map((s) => `/categories/${s}`),
  ...[...publicTools].map((s) => `/tools/${s}`),
  ...contentPaths,
];
const fileFor = (path) => (path === "/" ? "index.html" : `${path.slice(1)}.html`);
const LINK = /href="\/(tools|categories)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[?#"])/g;
const refs = { t: new Map(), c: new Map() };
const problems = [];
const noindexPages = new Set();
const staging = join(out, "static-staging");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
let bytes = 0;
const t0 = Date.now();

async function one_(path) {
  const r = await render(path);
  if (r.status !== 200) return problems.push(`${path}: status ${r.status}`);
  if (!r.type.includes("text/html")) problems.push(`${path}: content-type ${r.type}`);
  const canonical = r.body.match(/rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== (otherCanonical.get(path) ?? SITE + path))
    problems.push(`${path}: canonical ${canonical}`);
  // Technical SEO: exactly one title, description and canonical; no preview/local host; valid JSON-LD with no invented
  // ratings or reviews. Whether the page is noindex is recorded and checked against the sitemap below.
  const count = (re) => (r.body.match(re) ?? []).length;
  if (count(/<title>[^<]+<\/title>/g) !== 1) problems.push(`${path}: not exactly one <title>`);
  if (count(/<meta name="description" /g) !== 1)
    problems.push(`${path}: not exactly one description`);
  if (count(/rel="canonical"/g) !== 1) problems.push(`${path}: not exactly one canonical`);
  if (/workers\.dev|localhost:|127\.0\.0\.1/.test(r.body))
    problems.push(`${path}: preview/local host in HTML`);
  for (const m of r.body.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      if (/"aggregateRating"|"review"/.test(JSON.stringify(JSON.parse(m[1]))))
        problems.push(`${path}: JSON-LD has ratings/reviews`);
    } catch {
      problems.push(`${path}: invalid JSON-LD`);
    }
  }
  if (/<meta name="robots" content="[^"]*noindex/.test(r.body)) noindexPages.add(path);
  for (const m of r.body.matchAll(LINK)) {
    const kind = m[1] === "tools" ? "t" : "c";
    const slug = m[2];
    if (kind === "t" && !publicTools.has(slug))
      problems.push(`${path}: links to non-public tool ${slug}`);
    if (kind === "c" && !publicCategories.includes(slug))
      problems.push(`${path}: links to non-public category ${slug}`);
    const set = refs[kind].get(slug) ?? new Set();
    set.add(path);
    refs[kind].set(slug, set);
  }
  const file = join(staging, fileFor(path));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, r.body);
  bytes += r.body.length;
}
const queue = [...paths];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await one_(p);
  }),
);
const nf = await render(NOT_FOUND_PROBE);
if (nf.status !== 404 || !nf.type.includes("text/html"))
  problems.push(`404 page: status ${nf.status}`);
// The 404 page is served for many URLs: it must not claim a canonical or og:url (it was rendered for the probe path).
const notFoundHtml = nf.body
  .replace(/<link rel="canonical"[^>]*>/g, "")
  .replace(/<meta property="og:url"[^>]*>/g, "");
if (/rel="canonical"|property="og:url"/.test(notFoundHtml))
  problems.push("404 page: still has a canonical or og:url");
if (!/<meta name="robots" content="[^"]*noindex/.test(notFoundHtml))
  problems.push("404 page: not noindex");
writeFileSync(join(staging, "404.html"), notFoundHtml);

// ------------------------------------------------------------------ sitemap + search index (same snapshot)
const rendered = new Set(paths);
// scripted imports that changed visible tool content without per-tool audit rows (their own timestamps: lastmod)
const sitemapEntries = await sitemapFromDb(
  DB,
  JSON.parse(readFileSync("db/metadata/content-imports.json", "utf8")),
);
const seenLoc = new Set();
for (const e of sitemapEntries) {
  if (seenLoc.has(e.path)) problems.push(`sitemap: duplicate ${e.path}`);
  seenLoc.add(e.path);
  if (!rendered.has(e.path)) problems.push(`sitemap: ${e.path} is not a page of this build`);
  if (e.lastmod !== undefined && Number.isNaN(Date.parse(e.lastmod)))
    problems.push(`sitemap: bad lastmod ${e.lastmod} for ${e.path}`);
  if (noindexPages.has(e.path)) problems.push(`sitemap: ${e.path} is a noindex page`);
}
// ...and the other way round: every indexable page of this build is in the sitemap.
for (const p of paths)
  if (!noindexPages.has(p) && !otherCanonical.has(p) && !seenLoc.has(p))
    problems.push(`sitemap: indexable page ${p} missing`);
const sitemapOut = sitemapFiles(sitemapEntries, SITE);
for (const [p, body] of sitemapOut) {
  // One complete root element, every <loc> absolute on this site, no unescaped "&".
  const root = body.includes("<sitemapindex") ? "sitemapindex" : "urlset";
  if (
    !body.startsWith('<?xml version="1.0" encoding="UTF-8"?>') ||
    !body.trimEnd().endsWith(`</${root}>`)
  )
    problems.push(`${p}: not a complete <${root}> document`);
  for (const m of body.matchAll(/<loc>([^<]*)<\/loc>/g))
    if (!m[1].startsWith(`${SITE}/`)) problems.push(`${p}: loc ${m[1]}`);
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(body)) problems.push(`${p}: unescaped &`);
}
// Old tool slugs whose tool is public: the gate answers them with a 301 without the app (others are 404, as in the app).
const redirects = Object.fromEntries(
  raw
    .prepare(
      `SELECT r.old_slug, t.slug FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE ${PUBLIC} ORDER BY r.old_slug`,
    )
    .all()
    .map((r) => [r.old_slug, r.slug]),
);
for (const [from, to] of Object.entries(redirects)) {
  if (publicTools.has(from)) problems.push(`redirect: old slug ${from} is also a current tool`);
  if (!publicTools.has(to)) problems.push(`redirect: ${from} -> ${to} is not a public tool`);
}
const searchIndex = await searchIndexFromDb(DB);
if (searchIndex.tools.length !== publicTools.size)
  problems.push(`search index: ${searchIndex.tools.length} tools, expected ${publicTools.size}`);
for (const t of searchIndex.tools)
  if (!publicTools.has(t[0])) problems.push(`search index: non-public tool ${t[0]}`);

if (problems.length) {
  rmSync(staging, { recursive: true, force: true });
  fail(`${problems.length} problem(s):\n  ${problems.slice(0, 20).join("\n  ")}`);
}

// ------------------------------------------------------------------ reverse index + build info
for (const [kind, map] of Object.entries(refs))
  for (const [slug, set] of map) {
    const f = join(staging, "_static/refs", kind, `${slug}.json`);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify([...set].sort()));
  }
for (const [p, body] of sitemapOut) {
  mkdirSync(dirname(join(staging, p)), { recursive: true });
  writeFileSync(join(staging, p), body);
}
mkdirSync(join(staging, "_static"), { recursive: true });
writeFileSync(
  join(staging, SITEMAP_DATA_PATH),
  JSON.stringify({ snapshotAt, entries: sitemapEntries }),
);
writeFileSync(join(staging, SEARCH_INDEX_PATH), JSON.stringify(searchIndex));
writeFileSync(join(staging, "_static/redirects.json"), JSON.stringify(redirects));
const files = [...paths.map(fileFor), "404.html", ...[...sitemapOut.keys()].map((p) => p.slice(1))];
const build = {
  buildId: randomUUID(),
  snapshotVersion,
  snapshotAt,
  contentVersion,
  newsVersion,
  generatedAt: new Date().toISOString(),
  pages: files.length,
};
mkdirSync(join(staging, "_static"), { recursive: true });
writeFileSync(join(staging, "_static/build.json"), JSON.stringify(build));
writeFileSync(join(staging, "_static/files.json"), JSON.stringify(files));

// ------------------------------------------------------------------ swap into .output/public (only now)
const pub = join(out, "public");
const previous = join(pub, "_static/files.json");
if (existsSync(previous))
  for (const f of JSON.parse(readFileSync(previous, "utf8"))) rmSync(join(pub, f), { force: true });
rmSync(join(pub, "_static"), { recursive: true, force: true });
cpSync(staging, pub, { recursive: true });
rmSync(staging, { recursive: true, force: true });
console.log(
  JSON.stringify({
    ok: true,
    pages: files.length,
    tools: publicTools.size,
    categories: publicCategories.length,
    contentPages: contentPaths.length,
    htmlMB: Math.round((bytes / 1048576) * 10) / 10,
    refs: { tools: refs.t.size, categories: refs.c.size },
    sitemapUrls: sitemapEntries.length,
    redirects: Object.keys(redirects).length,
    searchIndexKB: Math.round(JSON.stringify(searchIndex).length / 1024),
    snapshotVersion,
    snapshotAt,
    seconds: Math.round((Date.now() - t0) / 1000),
  }),
);
process.exit(0);

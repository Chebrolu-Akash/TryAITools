#!/usr/bin/env bun
// Read-only sitemap / indexing audit. Compares the pages that are ELIGIBLE for the sitemap (from a D1 snapshot) with the
// URLs a live sitemap actually lists, and explains every excluded tool. Optionally fetches every listed URL.
//
//   bun scripts/seo/sitemap-audit.mjs --snapshot <export.sql | d1.sqlite> --sitemap <origin> [--check] [--samples N]
//
//   --snapshot  a `wrangler d1 export` file (or a SQLite file) of the database the site was built from
//   --sitemap   the site to read /sitemap.xml from (an index is followed), e.g. https://tryaitools.io
//   --check     also fetch every listed URL: HTTP 200, canonical = https://tryaitools.io<path>, no robots noindex in the
//               page; and N excluded tool pages (--samples, default 20): they must carry noindex or not answer 200
// Nothing is written anywhere; the exit code is 1 when the sitemap and the eligible set differ or a check fails.
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const snapshot = arg("--snapshot");
const site = arg("--sitemap")?.replace(/\/+$/, "");
const check = process.argv.includes("--check");
const samples = Number(arg("--samples", "20"));
if (!snapshot || !site) {
  console.error(
    "Usage: bun scripts/seo/sitemap-audit.mjs --snapshot <file> --sitemap <origin> [--check]",
  );
  process.exit(2);
}
const CANONICAL = "https://tryaitools.io";

// ------------------------------------------------------------------ eligible set (same rules as src/static/sitemap.ts)
const db = snapshot.endsWith(".sql")
  ? new Database(":memory:")
  : new Database(snapshot, { readonly: true });
if (snapshot.endsWith(".sql")) db.exec(readFileSync(snapshot, "utf8"));
const all = (sql) => db.query(sql).all();
const has = (t) => all(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${t}'`).length > 0;

const tools = all(
  `SELECT t.slug, t.name, t.status, t.indexing, t.needs_review, t.content_source, t.tagline, c.status AS cstatus
     FROM tools t JOIN categories c ON c.id = t.category_id ORDER BY t.sort_order, t.id`,
);
const productKey = (n) =>
  n
    .replace(/ \(.+\)$/, "")
    .trim()
    .toLowerCase();
const indexedProducts = new Set(
  tools
    .filter((t) => t.status === "published" && t.indexing === "index")
    .map((t) => productKey(t.name)),
);
const reasonOf = (t) => {
  if (t.status !== "published") return `not published (${t.status})`;
  if (t.needs_review) return "flagged for review";
  if (t.cstatus !== "published") return "category not public";
  if (t.indexing !== "index") {
    if (indexedProducts.has(productKey(t.name)))
      return "noindex: another listing of the same product is the indexed page";
    if (!t.tagline) return "noindex: unreviewed import (category template text only)";
    return "noindex: set by an editor";
  }
  return null;
};
const exclusions = {};
const excludedSlugs = {};
const eligibleTools = [];
for (const t of tools) {
  const r = reasonOf(t);
  if (r) {
    exclusions[r] = (exclusions[r] ?? 0) + 1;
    (excludedSlugs[r] ??= []).push(t.slug);
  } else eligibleTools.push(`/tools/${t.slug}`);
}
const categories = all("SELECT slug FROM categories WHERE status = 'published'").map(
  (c) => `/categories/${c.slug}`,
);
const news = has("news_articles")
  ? all("SELECT slug FROM news_articles WHERE status = 'published'").map((n) => `/news/${n.slug}`)
  : [];

// ------------------------------------------------------------------ live sitemap
const get = async (u, opts = {}) => {
  for (let i = 0; i < 3; i++)
    try {
      return await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20000), ...opts });
    } catch (e) {
      if (i === 2) throw e;
    }
};
const locsOf = (x) =>
  [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const root = await (await get(`${site}/sitemap.xml`)).text();
const files = [];
let listed = [];
if (/<sitemapindex[\s>]/.test(root)) {
  for (const u of locsOf(root)) {
    const body = await (await get(u.replace(CANONICAL, site))).text();
    files.push({
      file: u,
      urls: locsOf(body).length,
      bytes: new TextEncoder().encode(body).length,
    });
    listed.push(...locsOf(body));
  }
} else {
  files.push({
    file: `${CANONICAL}/sitemap.xml`,
    urls: locsOf(root).length,
    bytes: new TextEncoder().encode(root).length,
  });
  listed = locsOf(root);
}
const problems = [];
const paths = listed.map((u) => {
  if (!u.startsWith(`${CANONICAL}/`) && u !== CANONICAL)
    problems.push(`not a canonical production URL: ${u}`);
  return u.slice(CANONICAL.length) || "/";
});
const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
for (const d of new Set(dupes)) problems.push(`duplicate in sitemap: ${d}`);
for (const p of paths)
  if (/^\/(admin|api)(\/|$)|[?#]|\.workers\.dev/.test(p))
    problems.push(`private or query URL listed: ${p}`);
const listedSet = new Set(paths);
const missing = (want) => want.filter((p) => !listedSet.has(p));
const listedTools = paths.filter((p) => p.startsWith("/tools/"));
const eligibleSet = new Set(eligibleTools);
const notEligibleListed = listedTools.filter((p) => !eligibleSet.has(p));
for (const p of missing(eligibleTools)) problems.push(`eligible tool missing from sitemap: ${p}`);
for (const p of notEligibleListed) problems.push(`listed tool that is not eligible: ${p}`);
for (const p of missing(categories)) problems.push(`public category missing: ${p}`);
for (const p of missing(news)) problems.push(`published news article missing: ${p}`);

// ------------------------------------------------------------------ optional HTTP checks
const http = { checked: 0, failures: [], excludedSampled: 0 };
const pool = async (list, fn, n = 8) => {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < list.length) await fn(list[i++]);
    }),
  );
};
const inspect = async (path) => {
  const r = await get(site + path);
  const html = r.status === 200 ? await r.text() : "";
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
  const metaRobots = /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? "";
  return { status: r.status, canonical, noindex: /noindex/i.test(metaRobots) };
};
if (check) {
  await pool(paths, async (p) => {
    const x = await inspect(p);
    http.checked++;
    if (x.status !== 200) http.failures.push(`${x.status} ${p}`);
    else {
      if (x.canonical !== CANONICAL + (p === "/" ? "/" : p) && x.canonical !== CANONICAL + p)
        http.failures.push(`canonical ${x.canonical} on ${p}`);
      if (x.noindex) http.failures.push(`noindex on listed page ${p}`);
    }
  });
  const sample = Object.values(excludedSlugs).flatMap((s) =>
    s.slice(0, Math.max(1, Math.ceil(samples / 6))),
  );
  await pool(sample.slice(0, samples * 2), async (slug) => {
    const x = await inspect(`/tools/${slug}`);
    http.excludedSampled++;
    if (x.status === 200 && !x.noindex)
      http.failures.push(`excluded page is indexable: /tools/${slug}`);
  });
}

const report = {
  site,
  snapshot,
  sitemapFiles: files,
  urlsInSitemap: paths.length,
  bySection: paths.reduce(
    (m, p) => ((m["/" + (p.split("/")[1] ?? "")] = (m["/" + (p.split("/")[1] ?? "")] ?? 0) + 1), m),
    {},
  ),
  tools: {
    total: tools.length,
    published: tools.filter((t) => t.status === "published").length,
    eligible: eligibleTools.length,
    listed: listedTools.length,
    excluded: exclusions,
  },
  categories: {
    public: categories.length,
    listed: paths.filter((p) => p.startsWith("/categories/")).length,
  },
  news: { published: news.length },
  ...(check ? { http } : {}),
  problems: [...problems, ...http.failures],
};
console.log(JSON.stringify(report, null, 1));
process.exit(report.problems.length ? 1 : 0);

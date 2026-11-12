// @vitest-environment jsdom
// Sitemap coverage: the generated sitemap must list EVERY eligible page (no query limit, pagination or file split may
// silently drop one) and nothing that is not eligible; large sitemaps become a valid sitemap index; robots.txt points at
// it and never blocks public pages.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { SITE_URL } from "@/lib/site";
import {
  FIXED_PAGES,
  MAX_URLS_PER_FILE,
  SITEMAP_PATH,
  sitemapFiles,
  sitemapFromDb,
  type SitemapEntry,
} from "@/static/sitemap";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

const ORIGIN = "https://tryaitools.io";
const N = 3000; // more tools than any page size or batch the code might use
const parser = new DOMParser();
const xml = (s: string) => {
  const doc = parser.parseFromString(s, "application/xml");
  expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  return doc;
};
const locs = (doc: Document) => [...doc.getElementsByTagName("loc")].map((l) => l.textContent!);

/**
 * Builds a catalogue covering every exclusion reason. Tool i is:
 *   i % 10 === 0  draft            (excluded: not published)
 *   i % 10 === 1  archived         (excluded: not published)
 *   i % 10 === 2  needs_review     (excluded: flagged)
 *   i % 10 === 3  noindex          (excluded: intentionally noindex)
 *   i % 10 === 4  in a draft category (excluded: its category is not public)
 *   otherwise     published + index in a published category -> eligible
 */
function seed(db: TestDb) {
  db.raw.exec(`
    INSERT INTO categories (id, slug, name, status) VALUES
      ('c1', 'writing', 'Writing', 'published'),
      ('c2', 'images', 'Images', 'published'),
      ('c3', 'hidden', 'Hidden', 'draft');`);
  const eligible: string[] = [];
  const reasons: Record<string, number> = {};
  const values: string[] = [];
  for (let i = 0; i < N; i++) {
    const slug = `tool-${i}`;
    const kind = i % 10;
    const status = kind === 0 ? "draft" : kind === 1 ? "archived" : "published";
    const indexing = kind === 3 || kind === 0 || kind === 1 ? "noindex" : "index";
    const review = kind === 2 ? 1 : 0;
    const cat = kind === 4 ? "c3" : i % 2 ? "c1" : "c2";
    const reason =
      kind === 0 || kind === 1
        ? "not published"
        : kind === 2
          ? "needs review"
          : kind === 3
            ? "noindex"
            : kind === 4
              ? "category not public"
              : null;
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    else eligible.push(`/tools/${slug}`);
    values.push(
      `('t${i}', '${slug}', 'Tool ${i}', 'https://example.com/${i}', '${cat}', '${status}', '${indexing}', ${review}, ${i})`,
    );
  }
  for (let i = 0; i < values.length; i += 500)
    db.raw.exec(
      `INSERT INTO tools (id, slug, name, url, category_id, status, indexing, needs_review, sort_order) VALUES ${values.slice(i, i + 500).join(",")};`,
    );
  return { eligible, reasons };
}

describe("sitemap coverage", () => {
  let db: TestDb;
  let entries: SitemapEntry[];
  let expected: { eligible: string[]; reasons: Record<string, number> };
  beforeAll(async () => {
    db = createTestDb();
    expected = seed(db);
    entries = await sitemapFromDb(db);
  });

  it("lists every eligible tool, and nothing else, with no limit or pagination cutting it short", () => {
    const tools = entries.filter((e) => e.path.startsWith("/tools/")).map((e) => e.path);
    expect(expected.eligible.length).toBe(1500); // 5 of every 10
    expect(new Set(tools)).toEqual(new Set(expected.eligible));
    expect(tools.length).toBe(expected.eligible.length);
    // every exclusion reason is represented and none of those tools is listed
    expect(expected.reasons).toEqual({
      "not published": 600,
      "needs review": 300,
      noindex: 300,
      "category not public": 300,
    });
  });

  it("lists the fixed pages and only the public categories, without duplicates", () => {
    const paths = entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of FIXED_PAGES) expect(paths).toContain(p.path);
    expect(paths.filter((p) => p.startsWith("/categories/")).sort()).toEqual([
      "/categories/images",
      "/categories/writing",
    ]);
    // never an admin, API, preview or query-string URL
    for (const p of paths) {
      expect(p).toMatch(/^\/[a-z0-9/-]*$/);
      expect(p).not.toMatch(/^\/(admin|api)(\/|$)/);
    }
  });

  it("writes valid XML with absolute canonical production URLs and ISO lastmod values", () => {
    const files = sitemapFiles(entries, SITE_URL);
    expect([...files.keys()]).toEqual([SITEMAP_PATH]); // 1,500+ URLs fit in one file
    const doc = xml(files.get(SITEMAP_PATH)!);
    expect(doc.documentElement.nodeName).toBe("urlset");
    const urls = locs(doc);
    expect(urls.length).toBe(entries.length);
    for (const u of urls) expect(u.startsWith(`${ORIGIN}/`)).toBe(true);
    for (const l of doc.getElementsByTagName("lastmod"))
      expect(Number.isFinite(Date.parse(l.textContent!))).toBe(true);
  });

  it("becomes a sitemap index above the URL limit, and every URL is in exactly one part", () => {
    const files = sitemapFiles(entries, SITE_URL, 400);
    const index = xml(files.get(SITEMAP_PATH)!);
    expect(index.documentElement.nodeName).toBe("sitemapindex");
    const parts = locs(index);
    expect(parts.length).toBe(Math.ceil(entries.length / 400));
    const all: string[] = [];
    parts.forEach((u, i) => {
      expect(u).toBe(`${ORIGIN}/sitemaps/${i + 1}.xml`);
      const part = xml(files.get(`/sitemaps/${i + 1}.xml`)!);
      expect(part.documentElement.nodeName).toBe("urlset");
      expect(locs(part).length).toBeLessThanOrEqual(400);
      all.push(...locs(part));
    });
    expect(all).toEqual(entries.map((e) => ORIGIN + e.path));
    expect(MAX_URLS_PER_FILE).toBeLessThanOrEqual(50_000);
  });

  it("also splits by size so no file exceeds the byte limit", () => {
    const max = 20_000;
    const files = sitemapFiles(entries, SITE_URL, MAX_URLS_PER_FILE, max);
    expect(files.size).toBeGreaterThan(2);
    let total = 0;
    for (const [p, body] of files) {
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(max);
      if (p !== SITEMAP_PATH) total += locs(xml(body)).length;
    }
    expect(total).toBe(entries.length);
  });
});

describe("robots.txt", () => {
  const robots = readFileSync("public/robots.txt", "utf8");
  // Google's rule: the longest matching Allow/Disallow path wins (Allow on a tie). Only the `*` group exists here.
  const rules = robots
    .split("\n")
    .map((l) => /^(Allow|Disallow):\s*(\S*)/i.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m && m[2] !== "")
    .map((m) => ({ allow: m[1]!.toLowerCase() === "allow", path: m[2]! }));
  const allowed = (path: string) => {
    const hits = rules.filter((r) => path.startsWith(r.path));
    if (!hits.length) return true;
    const best = Math.max(...hits.map((r) => r.path.length));
    return hits.some((r) => r.path.length === best && r.allow);
  };

  it("points at the production sitemap", () => {
    expect(robots).toMatch(/^Sitemap: https:\/\/tryaitools\.io\/sitemap\.xml$/m);
    expect(robots).toMatch(/^User-agent: \*$/m);
  });
  it("allows public pages, assets and the sitemap", () => {
    for (const p of [
      "/",
      "/tools",
      "/tools/chatgpt",
      "/categories/ai-writing-tools",
      "/news",
      "/news/some-article",
      "/about",
      "/assets/index-abc.js",
      "/favicon.ico",
      "/sitemap.xml",
      "/sitemaps/1.xml",
    ])
      expect(allowed(p), p).toBe(true);
  });
  it("keeps the admin and the API out", () => {
    for (const p of ["/admin", "/admin/tools", "/api/search", "/api/admin/stats"])
      expect(allowed(p), p).toBe(false);
  });
});

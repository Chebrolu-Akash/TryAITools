// The XML sitemap for the static site. The pre-render builds it from a D1 snapshot (`sitemapFromDb`) and writes the
// entries to /_static/sitemap.json; between builds the gate keeps it current (`sitemapSince`) by applying only what
// changed in D1 since that snapshot, so a sitemap request never loads the whole catalogue.
//
// What is listed: the fixed pages, published categories, and tools that are public (published, not flagged, in a published
// category) AND marked indexing = 'index' (one page per product), and the content sections (see contentEntries).
//
// lastmod is the last meaningful change to the page, from audit_events (Admin and the approved scripts record every write
// there) and the recorded content imports (ContentImport):
//   tool       its creation or its last visible content change (see CONTENT_EVENT_SQL); publish/flag/etc. do not count
//   category   its own edits, and any change to a tool it lists (content, publish, unpublish, flag, delete, indexing);
//              changes nobody sees (stored drafts, URL health checks: INVISIBLE_EVENT_SQL) do not count
//   /, /tools, /categories   the newest change to anything they list
//   other fixed pages        none (their content is not in D1)
// A URL that reappears between builds (e.g. republished) takes the time it became public.
//
// No runtime imports (types only): the pre-render (plain Node) imports this file directly.
import type { D1DatabaseLike } from "@/lib/db/types";

export type SitemapEntry = {
  path: string;
  lastmod?: string | undefined;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};
/** What the build writes to /_static/sitemap.json. */
export type SitemapBase = { snapshotAt: string; entries: SitemapEntry[] };

export const SITEMAP_PATH = "/sitemap.xml";
export const SITEMAP_DATA_PATH = "/_static/sitemap.json";
/** The protocol allows 50,000 URLs per file; stay well below it. */
export const MAX_URLS_PER_FILE = 45_000;
export const sitemapFilePath = (n: number) => `/sitemaps/${n}.xml`;
const FILE = /^\/sitemaps\/([1-9][0-9]{0,3})\.xml$/;
/** True for /sitemap.xml and the /sitemaps/<n>.xml parts of a sitemap index. */
export const isSitemapPath = (path: string) => path === SITEMAP_PATH || FILE.test(path);

export const FIXED_PAGES: SitemapEntry[] = [
  { path: "/", changefreq: "daily", priority: 1.0 },
  { path: "/tools", changefreq: "daily", priority: 0.9 },
  { path: "/categories", changefreq: "weekly", priority: 0.8 },
  { path: "/about", changefreq: "monthly", priority: 0.5 },
  { path: "/privacy", changefreq: "yearly", priority: 0.3 },
  { path: "/terms", changefreq: "yearly", priority: 0.3 },
  { path: "/affiliate-disclosure", changefreq: "yearly", priority: 0.3 },
  { path: "/how-we-review", changefreq: "monthly", priority: 0.4 },
];
/** Fixed pages that list the catalogue, so their lastmod follows it. */
const LISTINGS = new Set(["/", "/tools", "/categories"]);
const categoryEntry = (slug: string, lastmod?: string): SitemapEntry => ({
  path: `/categories/${slug}`,
  lastmod,
  changefreq: "weekly",
  priority: 0.8,
});
const toolEntry = (slug: string, lastmod?: string): SitemapEntry => ({
  path: `/tools/${slug}`,
  lastmod,
  changefreq: "monthly",
  priority: 0.6,
});

const PUBLIC = "t.status = 'published' AND t.needs_review = 0 AND c.status = 'published'";
const LISTED = `${PUBLIC} AND t.indexing = 'index'`;

// ---------------------------------------------------------------- what counts as a content change of a tool page
// lastmod moves only when something a visitor sees on the tool page changed. Status, indexing, review state, URL health
// checks, stored-but-unpublished drafts and category memberships (shown on category pages, not the tool page) do not
// count; they still move the category pages and listings, as before.
//   tool.create, tool.update        Admin edits
//   tool.review_approve             an approved draft is copied into the public fields
//   tool.bulk_update                Admin bulk edits of category, subcategory, tags or pricing (summary "field: a → b")
//   tool.cleanup, tool.dead_listing  approved scripts: a category move ("category a -> b") or a new official URL
//                                   ("url https://… -> …", "URL updated: …")
// A batch-level row (entity_id 'metadata-import') names no tool: those imports are applied from ContentImport instead.
const CONTENT_EVENT_SQL = `(action IN ('tool.create', 'tool.update', 'tool.review_approve')
  OR (action = 'tool.bulk_update' AND entity_id <> 'metadata-import' AND (summary LIKE '%category_id: %'
      OR summary LIKE '%subcategory: %' OR summary LIKE '%pricing_model: %' OR summary LIKE '%tags: %'))
  OR (action IN ('tool.cleanup', 'tool.dead_listing') AND (summary LIKE 'category %' OR summary LIKE '%; category %'
      OR summary LIKE 'url http%' OR summary LIKE '%; url http%' OR summary LIKE 'URL updated:%')))`;
/** The same rule as CONTENT_EVENT_SQL, for rows already read. */
export function isContentEvent(action: string, entityId: string, summary: string): boolean {
  if (["tool.create", "tool.update", "tool.review_approve"].includes(action)) return true;
  if (action === "tool.bulk_update")
    return (
      entityId !== "metadata-import" &&
      /(category_id|subcategory|pricing_model|tags): /i.test(summary)
    );
  if (action === "tool.cleanup" || action === "tool.dead_listing")
    return /(^|; )category |(^|; )url http|^URL updated:/i.test(summary);
  return false;
}

// Events that change nothing any public page shows: a stored (unpublished) review draft, a rejected one, and URL health
// checks recorded by the clean-up (URL status, "needs manual review" notes). They move no lastmod at all; every other
// non-content event (publish, unpublish, flag, delete, indexing, status, memberships) still moves the category pages
// and listings that show the tool.
const INVISIBLE_EVENT_SQL = `(action IN ('tool.review_draft', 'tool.review_reject')
  OR (action IN ('tool.cleanup', 'tool.dead_listing') AND summary NOT LIKE '%; %' AND (summary LIKE 'url status %'
      OR summary LIKE 'needs manual review:%' OR summary LIKE 'reviewed tool, URL issue noted:%')))`;
/** The same rule as INVISIBLE_EVENT_SQL, for rows already read. */
export function isInvisibleEvent(action: string, summary: string): boolean {
  if (action === "tool.review_draft" || action === "tool.review_reject") return true;
  return (
    (action === "tool.cleanup" || action === "tool.dead_listing") &&
    !summary.includes("; ") &&
    /^(url status |needs manual review:|reviewed tool, URL issue noted:)/i.test(summary)
  );
}

/**
 * A scripted import that changed what tool pages show but wrote no per-tool audit row (db/metadata/content-imports.json,
 * generated from the import SQL by scripts/db/content-imports.mjs). A listed tool that existed at `at` takes `at` as a
 * content change. The timestamps are the imports' own; nothing is refreshed.
 */
export type ContentImport = { at: string; slugs: string[] };
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const later = (a: string | undefined, b: string | undefined) =>
  !a ? b || undefined : !b ? a : a > b ? a : b;
const rows = async (db: D1DatabaseLike, sql: string, ...params: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...params)
      .all<Row>()
  ).results;

/** Removes duplicate paths (first one wins) and puts the fixed pages first. */
function ordered(entries: SitemapEntry[]): SitemapEntry[] {
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const e of entries)
    if (!seen.has(e.path)) {
      seen.add(e.path);
      out.push(e);
    }
  return out;
}

// ---------------------------------------------------------------- content sections
// A section page (/learn/courses, /gadgets, ...) is listed once it has a published entry (it is noindex while empty); the
// Learning Hub (/learn) once any of its three sections has one. An entry is listed when it is published, indexable and
// canonical to itself (not a copy of a page elsewhere). lastmod: the entry's last update; for a section page, the newest
// of its entries. Few rows: read in full whenever content changed.
const CONTENT_SECTIONS = [
  { path: "/learn/courses", table: "courses", where: "kind = 'course'", indexing: true },
  { path: "/learn/books", table: "courses", where: "kind = 'book'", indexing: true },
  { path: "/learn/tutorials", table: "tutorials", where: "1", indexing: true },
  { path: "/gadgets", table: "gadgets", where: "1", indexing: true },
  { path: "/guest-articles", table: "guest_articles", where: "1", indexing: true },
  { path: "/blog", table: "blog_posts", where: "1", indexing: false },
] as const;
const LEARN_HUB = "/learn";
const CONTENT_PATH = /^\/(learn|gadgets|guest-articles|blog|news)(\/|$)/;
export const isContentPath = (path: string) => CONTENT_PATH.test(path);
const missingSchema = (e: unknown) =>
  /no such (table|column)/i.test(e instanceof Error ? e.message : String(e));

/** The sitemap entries of the content sections, from D1. A database without those tables yields none. */
export async function contentEntries(
  db: D1DatabaseLike,
  origin = "https://tryaitools.io",
): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  let hubNewest: string | undefined;
  let hub = false;
  for (const s of CONTENT_SECTIONS) {
    let list: Row[];
    try {
      const canonical = ["guest_articles", "blog_posts"].includes(s.table)
        ? "canonical_url"
        : "NULL";
      list = await rows(
        db,
        `SELECT slug, updated_at, CASE WHEN ${s.indexing ? "indexing = 'index'" : "1"}
                AND (${canonical} IS NULL OR ${canonical} = '' OR ${canonical} = ? || slug) THEN 1 ELSE 0 END AS listed
           FROM ${s.table} WHERE status = 'published' AND ${s.where} ORDER BY published_at DESC, slug`,
        `${origin}${s.path}/`,
      );
    } catch (e) {
      if (missingSchema(e)) continue;
      throw e;
    }
    if (list.length === 0) continue;
    let newest: string | undefined;
    const items: SitemapEntry[] = [];
    for (const r of list) {
      const at = str(r["updated_at"]) || undefined;
      newest = later(newest, at);
      if (Number(r["listed"]) === 1)
        items.push({
          path: `${s.path}/${str(r["slug"])}`,
          lastmod: at,
          changefreq: "monthly",
          priority: 0.6,
        });
    }
    out.push({ path: s.path, lastmod: newest, changefreq: "weekly", priority: 0.7 }, ...items);
    if (s.path.startsWith(`${LEARN_HUB}/`)) {
      hub = true;
      hubNewest = later(hubNewest, newest);
    }
  }
  const news = await newsEntries(db);
  return hub
    ? [
        { path: LEARN_HUB, lastmod: hubNewest, changefreq: "weekly", priority: 0.8 },
        ...out,
        ...news,
      ]
    : [...out, ...news];
}

// AI News: /news once anything is published, each category page with a published article, and every published article
// (AI-written summaries that link to the original; each page is canonical to itself). lastmod: the article's last update;
// for /news and a category page, the newest of their articles.
async function newsEntries(db: D1DatabaseLike): Promise<SitemapEntry[]> {
  let list: Row[];
  try {
    list = await rows(
      db,
      "SELECT slug, category, updated_at FROM news_articles WHERE status = 'published' ORDER BY published_at DESC, slug",
    );
  } catch (e) {
    if (missingSchema(e)) return [];
    throw e;
  }
  if (list.length === 0) return [];
  let newest: string | undefined;
  const categories = new Map<string, string | undefined>();
  const items: SitemapEntry[] = [];
  for (const r of list) {
    const at = str(r["updated_at"]) || undefined;
    newest = later(newest, at);
    const c = str(r["category"]);
    categories.set(c, later(categories.get(c), at));
    items.push({
      path: `/news/${str(r["slug"])}`,
      lastmod: at,
      changefreq: "monthly",
      priority: 0.5,
    });
  }
  return [
    { path: "/news", lastmod: newest, changefreq: "daily", priority: 0.8 },
    ...[...categories]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, at]): SitemapEntry => ({
        path: `/news/category/${c}`,
        lastmod: at,
        changefreq: "daily",
        priority: 0.6,
      })),
    ...items,
  ];
}

/** `entries` with every content-section entry replaced by `content` (placed after the fixed pages). */
export function replaceContent(entries: SitemapEntry[], content: SitemapEntry[]): SitemapEntry[] {
  const rest = entries.filter((e) => !isContentPath(e.path));
  const fixed = new Set(FIXED_PAGES.map((p) => p.path));
  return ordered([
    ...rest.filter((e) => fixed.has(e.path)),
    ...content,
    ...rest.filter((e) => !fixed.has(e.path)),
  ]);
}

/** The complete sitemap from D1. Used by the pre-render, against a local snapshot (reads every tool once). */
export async function sitemapFromDb(
  db: D1DatabaseLike,
  imports: ContentImport[] = [],
): Promise<SitemapEntry[]> {
  // slug -> the newest import that changed it
  const imported = new Map<string, string>();
  for (const i of imports)
    for (const s of i.slugs) imported.set(s, later(imported.get(s), i.at) ?? i.at);
  const [tools, categories] = await Promise.all([
    rows(
      db,
      `WITH edits AS (SELECT entity_id AS slug, max(at) AS at FROM audit_events
                       WHERE entity_type = 'tool' AND ${CONTENT_EVENT_SQL} GROUP BY entity_id),
            other AS (SELECT entity_id AS slug, max(at) AS at FROM audit_events
                       WHERE entity_type = 'tool' AND NOT ${CONTENT_EVENT_SQL} AND NOT ${INVISIBLE_EVENT_SQL}
                       GROUP BY entity_id)
       SELECT t.slug, c.slug AS category, t.indexing, CASE WHEN ${PUBLIC} THEN 1 ELSE 0 END AS pub,
              t.created_at AS created, max(t.created_at, COALESCE(e.at, '')) AS edited, COALESCE(o.at, '') AS other
         FROM tools t JOIN categories c ON c.id = t.category_id
         LEFT JOIN edits e ON e.slug = t.slug LEFT JOIN other o ON o.slug = t.slug
        ORDER BY t.sort_order, t.id`,
    ),
    rows(
      db,
      `SELECT c.slug, c.indexing, max(c.created_at, COALESCE((SELECT max(at) FROM audit_events a WHERE a.entity_type = 'category'
                AND a.entity_id = c.slug AND a.action IN ('category.create', 'category.update')), '')) AS edited
         FROM categories c WHERE c.status = 'published' ORDER BY c.sort_order, c.name`,
    ),
  ]);
  const categoryMod = new Map<string, string | undefined>();
  for (const c of categories) categoryMod.set(str(c["slug"]), str(c["edited"]) || undefined);
  const toolEntries: SitemapEntry[] = [];
  for (const t of tools) {
    const category = str(t["category"]);
    const pub = Number(t["pub"]) === 1;
    const imp = imported.get(str(t["slug"]));
    // an import changes only tools that already existed when it ran
    const edited =
      imp && imp >= str(t["created"]) ? later(str(t["edited"]), imp)! : str(t["edited"]);
    // A tool's edits change the category page only while it is listed there; publish/unpublish/flag/delete always do.
    if (categoryMod.has(category))
      categoryMod.set(
        category,
        later(categoryMod.get(category), later(pub ? edited : undefined, str(t["other"]))),
      );
    if (pub && t["indexing"] === "index") toolEntries.push(toolEntry(str(t["slug"]), edited));
  }
  // Every public category moves the listings' lastmod (they list its tools), but a category an editor set to noindex
  // gets no sitemap entry of its own.
  const noindex = new Set(
    categories.filter((c) => c["indexing"] === "noindex").map((c) => str(c["slug"])),
  );
  let newest: string | undefined;
  for (const m of categoryMod.values()) newest = later(newest, m);
  return ordered([
    ...FIXED_PAGES.map((p) => (LISTINGS.has(p.path) ? { ...p, lastmod: newest } : p)),
    ...(await contentEntries(db)),
    ...[...categoryMod]
      .filter(([slug]) => !noindex.has(slug))
      .map(([slug, m]) => categoryEntry(slug, m)),
    ...toolEntries,
  ]);
}

/**
 * The sitemap now: the build-time entries with only what changed since the snapshot applied.
 * - A listed tool or category whose record is gone, or that is no longer public/indexable, is dropped (so deletions are
 *   caught even though their rows no longer exist, and a renamed tool's old URL disappears).
 * - Tools and categories that became public since the build are added (a renamed tool appears under its new slug).
 * `categoriesOfDeleted` gives the category pages a deleted tool was listed on (the build's reverse index), so their
 * lastmod can follow the deletion. Reads only rows changed since the snapshot, the listed tools, and the categories.
 */
export async function sitemapSince(
  db: D1DatabaseLike,
  base: SitemapBase,
  categoriesOfDeleted: (slug: string) => Promise<string[]> = async () => [],
): Promise<SitemapEntry[]> {
  const since = base.snapshotAt;
  const listedTools = base.entries
    .filter((e) => e.path.startsWith("/tools/"))
    .map((e) => e.path.slice("/tools/".length));
  const [events, categories, newTools, viaCategory] = await Promise.all([
    rows(
      db,
      "SELECT action, entity_type, entity_id, summary, at FROM audit_events WHERE at > ? AND entity_type IN ('tool', 'category')",
      since,
    ),
    rows(db, "SELECT slug, status, indexing, updated_at FROM categories"),
    rows(
      db,
      `SELECT t.slug, t.updated_at AS at FROM tools t JOIN categories c ON c.id = t.category_id
        WHERE t.status = 'published' AND t.updated_at > ? AND ${LISTED}`,
      since,
    ),
    rows(
      db,
      `SELECT t.slug, c.updated_at AS at FROM tools t JOIN categories c ON c.id = t.category_id
        WHERE t.category_id IN (SELECT id FROM categories WHERE updated_at > ? AND status = 'published') AND ${LISTED}`,
      since,
    ),
  ]);
  const eventTools = events
    .filter((e) => e["entity_type"] === "tool")
    .map((e) => str(e["entity_id"]));
  const state = new Map<string, Row>();
  for (const r of await rows(
    db,
    `SELECT t.slug, c.slug AS category, CASE WHEN ${LISTED} THEN 1 ELSE 0 END AS listed,
            CASE WHEN ${PUBLIC} THEN 1 ELSE 0 END AS pub
       FROM tools t JOIN categories c ON c.id = t.category_id
      WHERE t.slug IN (SELECT value FROM json_each(?))`,
    JSON.stringify([...new Set([...listedTools, ...eventTools])]),
  ))
    state.set(str(r["slug"]), r);

  const published = new Map<string, string>();
  for (const c of categories)
    // listed categories: public AND not set to noindex (a noindex one is dropped, and comes back when indexed again)
    if (c["status"] === "published" && c["indexing"] !== "noindex")
      published.set(str(c["slug"]), str(c["updated_at"]));
  const before = new Map(base.entries.map((e) => [e.path, e]));
  const out = new Map<string, SitemapEntry>();
  for (const e of base.entries) {
    if (e.path.startsWith("/tools/")) {
      if (Number(state.get(e.path.slice(7))?.["listed"]) === 1) out.set(e.path, { ...e });
    } else if (e.path.startsWith("/categories/")) {
      if (published.has(e.path.slice(12))) out.set(e.path, { ...e });
    } else out.set(e.path, { ...e });
  }
  for (const [slug, at] of published) {
    const p = `/categories/${slug}`;
    if (!out.has(p)) out.set(p, categoryEntry(slug, at));
  }
  for (const r of [...newTools, ...viaCategory]) {
    const p = `/tools/${str(r["slug"])}`;
    const cur = out.get(p);
    if (!cur) out.set(p, toolEntry(str(r["slug"]), str(r["at"])));
    else if (!before.has(p)) cur.lastmod = later(cur.lastmod, str(r["at"]));
  }

  const bump = (path: string, at: string) => {
    const e = out.get(path);
    if (e) e.lastmod = later(e.lastmod, at);
  };
  for (const ev of events) {
    const at = str(ev["at"]);
    const slug = str(ev["entity_id"]);
    if (ev["entity_type"] === "tool" && isInvisibleEvent(str(ev["action"]), str(ev["summary"])))
      continue;
    let touchesListings = false;
    if (ev["entity_type"] === "category") {
      const p = `/categories/${slug}`;
      if (["category.create", "category.update"].includes(str(ev["action"]))) bump(p, at);
      touchesListings = out.has(p) || before.has(p);
    } else {
      const s = state.get(slug);
      const content = isContentEvent(str(ev["action"]), slug, str(ev["summary"]));
      if (content) bump(`/tools/${slug}`, at);
      const pub = Number(s?.["pub"]) === 1;
      // Which category pages list (or listed) it: its category now, or for a deleted tool the build's reverse index.
      const pages = s
        ? [`/categories/${str(s["category"])}`]
        : ev["action"] === "tool.delete"
          ? (await categoriesOfDeleted(slug)).filter((p) => p.startsWith("/categories/"))
          : [];
      if (pub || !content) for (const p of pages) bump(p, at);
      touchesListings = pub || (!content && pages.length > 0);
    }
    if (touchesListings) for (const p of LISTINGS) bump(p, at);
  }
  return ordered([
    ...FIXED_PAGES.map((p) => out.get(p.path)!).filter(Boolean),
    ...[...out.values()].filter((e) => isContentPath(e.path)), // as built; the gate replaces them if content changed
    ...[...out.values()].filter((e) => e.path.startsWith("/categories/")),
    ...[...out.values()].filter((e) => e.path.startsWith("/tools/")),
  ]);
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

const urlXml = (e: SitemapEntry, origin: string) =>
  `  <url>\n    <loc>${escapeXml(origin + e.path)}</loc>\n` +
  (e.lastmod ? `    <lastmod>${escapeXml(e.lastmod)}</lastmod>\n` : "") +
  `    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`;
const URLSET_OPEN = `${XML_HEAD}<urlset ${NS}>\n`;
const URLSET_CLOSE = `\n</urlset>\n`;

export const urlsetXml = (entries: SitemapEntry[], origin: string): string =>
  URLSET_OPEN + entries.map((e) => urlXml(e, origin)).join("\n") + URLSET_CLOSE;

/** The protocol allows 50 MB (uncompressed) per file; stay well below it. */
export const MAX_BYTES_PER_FILE = 45 * 1024 * 1024;
const utf8 = new TextEncoder();

/**
 * Splits the entries into sitemap files of at most `max` URLs AND at most `maxBytes` bytes each (whichever comes first),
 * in order, so no entry is ever dropped.
 */
function chunks(list: SitemapEntry[], origin: string, max: number, maxBytes: number) {
  const frame = utf8.encode(URLSET_OPEN + URLSET_CLOSE).length;
  const out: SitemapEntry[][] = [];
  let cur: SitemapEntry[] = [];
  let bytes = frame;
  for (const e of list) {
    const size = utf8.encode(urlXml(e, origin)).length + 1; // + the joining newline
    if (cur.length > 0 && (cur.length >= max || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = frame;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length > 0 || out.length === 0) out.push(cur);
  return out;
}

/**
 * The XML files to serve, by path. When everything fits in one file (`max` URLs, `maxBytes` bytes): just /sitemap.xml.
 * Otherwise /sitemap.xml becomes a sitemap index pointing at /sitemaps/1.xml, /sitemaps/2.xml, ...
 */
export function sitemapFiles(
  entries: SitemapEntry[],
  origin: string,
  max = MAX_URLS_PER_FILE,
  maxBytes = MAX_BYTES_PER_FILE,
): Map<string, string> {
  const list = ordered(entries);
  const parts = chunks(list, origin, max, maxBytes);
  if (parts.length === 1) return new Map([[SITEMAP_PATH, urlsetXml(list, origin)]]);
  const files = new Map<string, string>();
  const index: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const path = sitemapFilePath(i + 1);
    files.set(path, urlsetXml(part, origin));
    const newest = part.reduce<string | undefined>((m, e) => later(m, e.lastmod), undefined);
    index.push(
      `  <sitemap>\n    <loc>${escapeXml(origin + path)}</loc>\n` +
        (newest ? `    <lastmod>${escapeXml(newest)}</lastmod>\n` : "") +
        `  </sitemap>`,
    );
  }
  files.set(
    SITEMAP_PATH,
    `${XML_HEAD}<sitemapindex ${NS}>\n${index.join("\n")}\n</sitemapindex>\n`,
  );
  return files;
}

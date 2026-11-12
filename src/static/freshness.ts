// Decides, for each public page request, whether the pre-built static HTML may be served. Pure logic + small D1 queries;
// no React, no router, so it is cheap even on a freshly started Worker.
//
// A static page was rendered from a D1 snapshot (build.json: snapshotVersion, snapshotAt). Admin writes bump
// meta.catalog_version and stamp updated_at, deletes are recorded in audit_events. From those we derive, once per
// catalogue version and isolate:
//   hidden tools      published at build time, not public now (unpublished, archived, flagged, deleted, category hidden)
//   changed tools     public now, edited or published since the build (their pre-built page may be outdated)
//   hidden categories not published now
//   changed categories public now, edited since the build (name, description, indexing: robots noindex/index, ...)
// and the pages that reference any hidden tool or category (the build writes that reverse index into /_static/refs).
//
// Rules: a hidden tool or category page -> 404. A changed tool page (including the old slug of a renamed tool, which the
// app redirects with a 301), a changed category page, or any page that references something hidden ->
// rendered fresh by the app. Everything else -> the static file. If D1 cannot be read, nothing static is served unless
// this isolate verified the catalogue within the last minute (fail closed: never risk showing a hidden tool).
//
// Content sections (/courses, /gadgets, /guest-articles, /blog and their entries) follow meta.content_version, which
// every admin write to them bumps. While it equals the build's contentVersion their pre-built pages are served; once it
// differs, all of them are rendered fresh by the app (a few small indexed reads) until the next build. Coarse, but these
// pages are few and it can never show an unpublished entry.
//
// AI News (/news, /news/category/<c>, /news/<slug>) follows its own key, meta.news_version, bumped by every ingestion run
// that publishes and by admin changes, so a news run every few hours does not make the other content pages re-render.
// A news URL with a query string (search, page) is always rendered by the app: the static file holds only the default view.
import type { D1DatabaseLike } from "@/lib/db/types";

export type BuildInfo = {
  buildId: string;
  snapshotVersion: string;
  snapshotAt: string;
  /** meta.content_version of the snapshot; absent in builds made before the content sections existed. */
  contentVersion?: string;
  /** meta.news_version of the snapshot; absent in builds made before AI News existed. */
  newsVersion?: string;
};
export type Freshness = {
  version: string;
  unchanged: boolean;
  /** meta.content_version equals the build's: the pre-built content pages are current. */
  contentUnchanged: boolean;
  /** meta.news_version equals the build's: the pre-built /news pages are current. Absent = changed. */
  newsUnchanged?: boolean;
  hiddenTools: Set<string>;
  changedTools: Set<string>;
  hiddenCategories: Set<string>;
  /**
   * Categories still public but edited since the build (name, description, indexing, ...): their own page is rendered
   * fresh. Pages that merely link to them (every page, via the navigation) stay static until the next build.
   */
  changedCategories: Set<string>;
  /** Paths of static pages that link to a hidden tool or category. */
  affected: Set<string>;
};
export const CONTENT_PATHS = ["learn", "gadgets", "guest-articles", "blog"] as const;
export type ContentPath = (typeof CONTENT_PATHS)[number];
export type PageKind =
  | { kind: "tool"; slug: string; path: string }
  | { kind: "category"; slug: string; path: string }
  | { kind: "content"; section: ContentPath; slug: string | null; path: string }
  | { kind: "news"; path: string }
  | { kind: "page"; path: string }
  | { kind: "pass" };
export type Decision = "static" | "dynamic" | "not-found";

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const TOOL = new RegExp(`^/tools/(${SLUG})/?$`);
const CATEGORY = new RegExp(`^/categories/(${SLUG})/?$`);
const CONTENT = new RegExp(`^/(gadgets|guest-articles|blog)(?:/(${SLUG}))?/?$`);
// The Learning Hub: /learn, /learn/<courses|books|tutorials> and their entries.
const LEARN = new RegExp(`^/learn(?:/(courses|books|tutorials)(?:/(${SLUG}))?)?/?$`);
// AI News: /news, /news/category/<category>, /news/<slug>.
const NEWS = new RegExp(`^/news(?:/category/(${SLUG})|/(?!category(?:/|$))(${SLUG}))?/?$`);
/** Old AI Courses URLs: /courses (redirects to /learn/courses) and /courses/<slug> (the app redirects by kind). */
export const LEGACY_COURSES = new RegExp(`^/courses(?:/(${SLUG}))?/?$`);
/** Pages the build pre-renders (besides tool, category and content pages). */
export const STATIC_PAGES = [
  "/",
  "/tools",
  "/categories",
  "/about",
  "/privacy",
  "/terms",
  "/affiliate-disclosure",
  "/how-we-review",
  "/agents",
] as const; // /sitemap.xml is answered by the gate itself (see sitemap.ts)
const PAGES = new Set<string>(STATIC_PAGES);

/** Which public page a path is, normalising a trailing slash. Anything else goes straight to the app. */
export function classify(pathname: string): PageKind {
  const t = TOOL.exec(pathname);
  if (t) return { kind: "tool", slug: t[1]!, path: `/tools/${t[1]}` };
  const c = CATEGORY.exec(pathname);
  if (c) return { kind: "category", slug: c[1]!, path: `/categories/${c[1]}` };
  const l = LEARN.exec(pathname);
  if (l) {
    const path = ["/learn", l[1], l[2]].filter(Boolean).join("/");
    return { kind: "content", section: "learn", slug: l[2] ?? null, path };
  }
  const n = NEWS.exec(pathname);
  if (n)
    return {
      kind: "news",
      path: n[1] ? `/news/category/${n[1]}` : n[2] ? `/news/${n[2]}` : "/news",
    };
  const k = CONTENT.exec(pathname);
  if (k) {
    const section = k[1] as ContentPath;
    const slug = k[2] ?? null;
    return { kind: "content", section, slug, path: slug ? `/${section}/${slug}` : `/${section}` };
  }
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PAGES.has(p) ? { kind: "page", path: p } : { kind: "pass" };
}

export function decide(page: Exclude<PageKind, { kind: "pass" }>, f: Freshness): Decision {
  if (page.kind === "news") return f.newsUnchanged === true ? "static" : "dynamic";
  // A content page may also link to a tool or category that is hidden now (a blog post linking a tool): render it fresh.
  if (page.kind === "content")
    return f.contentUnchanged && !f.affected.has(page.path) ? "static" : "dynamic";
  if (f.unchanged) return "static";
  if (page.kind === "tool") {
    if (f.hiddenTools.has(page.slug)) return "not-found";
    if (f.changedTools.has(page.slug)) return "dynamic";
  }
  if (page.kind === "category") {
    if (f.hiddenCategories.has(page.slug)) return "not-found";
    if (f.changedCategories.has(page.slug)) return "dynamic";
  }
  return f.affected.has(page.path) ? "dynamic" : "static";
}

type Row = Record<string, unknown>;
const PUBLIC = "t.status = 'published' AND t.needs_review = 0 AND c.status = 'published'";

/** What changed in D1 since the snapshot the static pages were built from. */
export async function changesSince(db: D1DatabaseLike, snapshotAt: string) {
  const all = async (sql: string, ...p: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...p)
        .all<Row>()
    ).results;
  const [tools, viaCategory, categories, deletions, renamed] = await Promise.all([
    // Every status listed so the range uses idx_tools_status(status, updated_at) rather than scanning all tools.
    all(
      `SELECT t.slug, CASE WHEN ${PUBLIC} THEN 1 ELSE 0 END AS pub
         FROM tools t JOIN categories c ON c.id = t.category_id
        WHERE t.status IN ('draft', 'review', 'published', 'archived') AND t.updated_at > ?`,
      snapshotAt,
    ),
    all(
      // categories first, then their tools through idx_tools_category (a JOIN here scanned every tool)
      `SELECT t.slug FROM tools t
        WHERE t.category_id IN (SELECT id FROM categories WHERE updated_at > ? AND status <> 'published')`,
      snapshotAt,
    ),
    all("SELECT slug, status FROM categories WHERE updated_at > ?", snapshotAt),
    all(
      "SELECT action, entity_id FROM audit_events WHERE at > ? AND action IN ('tool.delete', 'category.delete')",
      snapshotAt,
    ),
    // Slugs renamed since the build: the old static page must not be served; the app answers with the 301.
    all("SELECT old_slug FROM tool_redirects WHERE created_at > ?", snapshotAt),
  ]);
  const hiddenTools = new Set<string>();
  const changedTools = new Set<string>();
  for (const r of tools)
    (Number(r["pub"]) === 1 ? changedTools : hiddenTools).add(String(r["slug"]));
  for (const r of viaCategory) {
    hiddenTools.add(String(r["slug"]));
    changedTools.delete(String(r["slug"]));
  }
  const hiddenCategories = new Set<string>();
  const changedCategories = new Set<string>();
  for (const r of categories)
    (r["status"] !== "published" ? hiddenCategories : changedCategories).add(String(r["slug"]));
  for (const r of deletions) {
    const slug = String(r["entity_id"]);
    if (r["action"] === "tool.delete") {
      hiddenTools.add(slug);
      changedTools.delete(slug);
    } else {
      hiddenCategories.add(slug);
      changedCategories.delete(slug);
    }
  }
  for (const r of renamed) {
    const slug = String(r["old_slug"]);
    hiddenTools.delete(slug);
    changedTools.add(slug);
  }
  return { hiddenTools, changedTools, hiddenCategories, changedCategories };
}

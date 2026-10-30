// SERVER ONLY. Where the public catalogue comes from.
//
// * D1 bound and imported  -> D1 is the source of truth. Only tools that are published, not flagged for review, and in a
//   published category are ever read; drafts, review, archived and flagged rows never leave the database.
// * No D1 binding (production today), or D1 never imported -> the bundled tools.json, exactly as before.
// * D1 errors -> the last catalogue read from D1 in this isolate if there is one, else tools.json.
//
// Freshness and CPU: every admin write (and every import) bumps meta.catalog_version. Each request reads that one row and
// reuses the in-memory catalogue while the version is unchanged, so a publish is visible on the next page load in every
// isolate. A reload happens only when the version changes, at most once at a time per isolate (concurrent requests share
// it), and reads only the list columns; a tool page fetches its own copy with a one-row query. Workers on the Free plan
// get ~10 ms of CPU per request, and parallel full reloads exceeded that (Cloudflare error 1102) in preview testing.
import data from "@/data/tools.json";
import { getD1 } from "@/lib/db/env";
import type { D1DatabaseLike } from "@/lib/db/types";
import {
  buildCatalog,
  type Catalog,
  type PublicCategory,
  type SourceTool,
  type ToolCopy,
} from "./model";

// Every getCatalog() call takes a ticket before it reads the version. A reload may write `cache` only if its ticket is newer
// than the cached entry's and than the last reset, so a slow reload of an older version can never overwrite a newer one.
let tickets = 0;
let resetFloor = 0;
let cache: { version: string; catalog: Catalog; ticket: number } | null = null;
let loading: { version: string; ticket: number; promise: Promise<Catalog> } | null = null;
let jsonCatalog: Catalog | null = null;

export const catalogFromJson = (): Catalog =>
  (jsonCatalog ??= buildCatalog({
    source: "json",
    categories: data.categories as PublicCategory[],
    tools: data.tools as SourceTool[],
  }));

const list = (v: unknown): string[] | null => {
  if (typeof v !== "string") return null;
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === "string" ? v : null);

type Row = Record<string, unknown>;

/** Reads the public subset of D1 (list columns only). Returns null when nothing has been imported yet. */
export async function loadCatalogFromD1(db: D1DatabaseLike): Promise<Catalog | null> {
  const total = await db.prepare("SELECT count(*) AS n FROM tools").first<{ n: number }>();
  if (!total || Number(total.n) === 0) return null;
  const cats = await db
    .prepare(
      "SELECT slug, name, subcategories FROM categories WHERE status = 'published' ORDER BY sort_order, name",
    )
    .all<Row>();
  const rows = await db
    .prepare(
      `SELECT t.slug, t.name, COALESCE(t.url, '') AS url, COALESCE(t.subcategory, '') AS subcategory, t.indexing,
              c.name AS category
         FROM tools t JOIN categories c ON c.id = t.category_id
        WHERE t.status = 'published' AND t.needs_review = 0 AND c.status = 'published'
        ORDER BY t.sort_order, t.id`,
    )
    .all<Row>();
  return buildCatalog({
    source: "d1",
    categories: cats.results.map((c) => ({
      slug: String(c["slug"]),
      name: String(c["name"]),
      subcategories: list(c["subcategories"]) ?? [],
    })),
    tools: rows.results.map((r): SourceTool => ({
      slug: String(r["slug"]),
      name: String(r["name"]),
      url: String(r["url"] ?? ""),
      category: String(r["category"]),
      subcategory: String(r["subcategory"] ?? ""),
      indexing: r["indexing"] === "index" ? "index" : "noindex",
    })),
  });
}

/** Admin-edited copy and SEO fields for one public tool (the list query leaves them out). */
export async function loadToolCopy(slug: string): Promise<ToolCopy | null> {
  const { db } = await getD1();
  if (!db) return null;
  try {
    const r = await db
      .prepare(
        `SELECT tagline, overview, best_for, features, pros, limits, steps, tips, seo_title, seo_description
           FROM tools WHERE slug = ? AND status = 'published' AND needs_review = 0`,
      )
      .bind(slug)
      .first<Row>();
    if (!r) return null;
    return {
      tagline: str(r["tagline"]),
      overview: str(r["overview"]),
      bestFor: str(r["best_for"]),
      features: list(r["features"]),
      pros: list(r["pros"]),
      limits: list(r["limits"]),
      steps: list(r["steps"]),
      tips: list(r["tips"]),
      seoTitle: str(r["seo_title"]),
      seoDescription: str(r["seo_description"]),
    };
  } catch (e) {
    console.error("catalog: copy read failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getCatalog(): Promise<Catalog> {
  const { db } = await getD1();
  if (!db) return catalogFromJson();
  // Taken BEFORE reading the version, so tickets follow the order in which versions were observed.
  const ticket = ++tickets;
  try {
    const row = await db
      .prepare("SELECT value FROM meta WHERE key = 'catalog_version'")
      .first<{ value: string }>();
    const version = row?.value ?? "";
    if (cache && cache.version === version) return cache.catalog;
    // Share a reload of the same version, or of a version observed after ours (it is at least as new).
    if (loading && (loading.version === version || loading.ticket > ticket))
      return await loading.promise;
    const promise = loadCatalogFromD1(db).then((c) => {
      const catalog = c ?? catalogFromJson();
      // A reload that finishes late must not overwrite a newer result, nor anything after a reset.
      if (ticket > resetFloor && ticket > (cache?.ticket ?? 0))
        cache = { version, catalog, ticket };
      return catalog;
    });
    loading = { version, ticket, promise };
    void promise.then(
      () => loading?.promise === promise && (loading = null),
      () => loading?.promise === promise && (loading = null),
    );
    return await promise;
  } catch (e) {
    console.error("catalog: D1 read failed", e instanceof Error ? e.message : e);
    return cache?.catalog ?? catalogFromJson();
  }
}

/** Current slug for a retired slug (tool_redirects), only if that tool is publicly visible. */
export async function redirectFor(oldSlug: string, catalog: Catalog): Promise<string | null> {
  if (catalog.source !== "d1") return null;
  const { db } = await getD1();
  if (!db) return null;
  try {
    const r = await db
      .prepare(
        "SELECT t.slug FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE r.old_slug = ?",
      )
      .bind(oldSlug)
      .first<{ slug: string }>();
    return r && catalog.bySlug.has(r.slug) ? r.slug : null;
  } catch {
    return null;
  }
}

/** Test hook: forget the in-memory catalogue. Reloads already in flight can no longer write the cache. */
export const resetCatalogCache = () => {
  resetFloor = tickets;
  cache = null;
  loading = null;
};

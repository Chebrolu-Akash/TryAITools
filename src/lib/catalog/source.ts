// SERVER ONLY. Where the public catalogue comes from.
//
// * D1 bound and imported  -> D1 is the source of truth. Only tools that are published, not flagged for review, and in a
//   published category are ever read; drafts, review, archived and flagged rows never leave the database.
// * No D1 binding (production today), or D1 never imported -> the bundled tools.json, exactly as before.
// * D1 errors -> the last catalogue read from D1 in this isolate if there is one, else tools.json.
//
// Freshness: every admin write bumps meta.catalog_version in the same batch. Each request reads that one row and reuses
// the in-memory catalogue only while the version is unchanged (and for at most MAX_AGE_MS, to also pick up imports made
// outside the admin). A publish is therefore visible on the next page load, in every isolate.
import data from "@/data/tools.json";
import { getD1 } from "@/lib/db/env";
import type { D1DatabaseLike } from "@/lib/db/types";
import { buildCatalog, type Catalog, type PublicCategory, type SourceTool } from "./model";

const MAX_AGE_MS = 60_000;
let cache: { version: string; at: number; catalog: Catalog } | null = null;
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

type ToolRow = Record<string, unknown>;

/** Reads the public subset of D1. Returns null when the tools table is empty (nothing imported yet). */
export async function loadCatalogFromD1(db: D1DatabaseLike): Promise<Catalog | null> {
  const total = await db.prepare("SELECT count(*) AS n FROM tools").first<{ n: number }>();
  if (!total || Number(total.n) === 0) return null;
  const cats = await db
    .prepare(
      "SELECT slug, name, subcategories FROM categories WHERE status = 'published' ORDER BY sort_order, name",
    )
    .all<ToolRow>();
  const rows = await db
    .prepare(
      `SELECT t.slug, t.name, COALESCE(t.url, '') AS url, COALESCE(t.subcategory, '') AS subcategory, t.indexing,
              t.tagline, t.overview, t.best_for, t.features, t.pros, t.limits, t.steps, t.tips,
              t.seo_title, t.seo_description, c.name AS category
         FROM tools t JOIN categories c ON c.id = t.category_id
        WHERE t.status = 'published' AND t.needs_review = 0 AND c.status = 'published'
        ORDER BY t.sort_order, t.id`,
    )
    .all<ToolRow>();
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
      copy: {
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
      },
    })),
  });
}

export async function getCatalog(): Promise<Catalog> {
  const { db } = await getD1();
  if (!db) return catalogFromJson();
  try {
    const row = await db
      .prepare("SELECT value FROM meta WHERE key = 'catalog_version'")
      .first<{ value: string }>();
    const version = row?.value ?? "";
    if (cache && cache.version === version && Date.now() - cache.at < MAX_AGE_MS)
      return cache.catalog;
    const catalog = (await loadCatalogFromD1(db)) ?? catalogFromJson();
    cache = { version, at: Date.now(), catalog };
    return catalog;
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

/** Test hook: forget the in-memory catalogue. */
export const resetCatalogCache = () => {
  cache = null;
};

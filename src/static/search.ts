// Search for the static site, without scanning D1 per query.
//
// The build writes every public tool (in display order) to /_static/search.json. The gate loads it once per isolate and
// searches it in memory. Between builds it applies what changed in D1 since the snapshot, once per catalogue version:
//   removed   tools hidden since the build (unpublished, flagged, archived, deleted, category hidden) -> `hidden`
//   replaced  tools edited or published since the build, and the tools of categories changed since the build, as they
//             are now (read with indexed queries; only those rows)
//   filtered  anything whose category is not published now
// So a hidden tool can never be returned, and a search reads 1 D1 row (the version check) unless the catalogue changed.
//
// Matching is exactly the D1 reader's: case-insensitive substring on name and subcategory, plain substring on the URL.
// No runtime imports (types only): the pre-render (plain Node) imports this file directly.
import type { PublicTool } from "@/lib/catalog/model";
import type { CategoryLink, ToolsPageData, ToolsQuery } from "@/lib/catalog/views";
import type { D1DatabaseLike } from "@/lib/db/types";

export const SEARCH_INDEX_PATH = "/_static/search.json";

/**
 * One tool in the index: slug, name, url, category slug, subcategory, sort_order, id (display order = sort_order, id),
 * pricing model ("" when not recorded; absent in indexes built before it existed), functional tags (labels; absent in
 * older indexes), and the slugs of the extra categories it is also listed in (tool_categories; absent when none).
 */
export type IndexTool = [
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  string?,
  string[]?,
  string[]?,
];
const PRICING = new Set(["free", "freemium", "free_trial", "paid"]);
const parseTags = (v: unknown): string[] => {
  try {
    const x: unknown = JSON.parse(String(v ?? "[]"));
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
};
/** Same as tagSlug in src/lib/tags.ts (copied: this file has no runtime imports). */
const tagSlug = (t: string) =>
  t
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export type SearchIndex = { categories: CategoryLink[]; tools: IndexTool[] };
/** The searchable list as it is now. */
export type SearchList = { categories: CategoryLink[]; tools: IndexTool[] };

const PUBLIC = "t.status = 'published' AND t.needs_review = 0 AND c.status = 'published'";
const BASE_COLUMNS =
  "t.slug, t.name, COALESCE(t.url, '') AS url, c.slug AS category, COALESCE(t.subcategory, '') AS subcategory, t.sort_order, t.id, t.pricing_model, t.tags";
const ALSO =
  "(SELECT json_group_array(c2.slug) FROM tool_categories m JOIN categories c2 ON c2.id = m.category_id WHERE m.tool_id = t.id AND c2.status = 'published') AS also";
const COLUMNS = `${BASE_COLUMNS}, ${ALSO}`;
/** Every status, so `status IN (...) AND updated_at > ?` uses idx_tools_status(status, updated_at) instead of a scan. */
const ANY_STATUS = "t.status IN ('draft', 'review', 'published', 'archived')";
type Row = Record<string, unknown>;
const rows = async (db: D1DatabaseLike, sql: string, ...params: unknown[]): Promise<Row[]> => {
  try {
    return (
      await db
        .prepare(sql)
        .bind(...params)
        .all<Row>()
    ).results;
  } catch (e) {
    // a database from before migration 0010 has no tool_categories: same query without the memberships column
    if (
      sql.includes(ALSO) &&
      /no such table:? tool_categories/i.test(e instanceof Error ? e.message : String(e))
    )
      return rows(db, sql.replace(`, ${ALSO}`, ""), ...params);
    throw e;
  }
};
const toIndexTool = (r: Row): IndexTool => {
  const t: IndexTool = [
    String(r["slug"]),
    String(r["name"]),
    String(r["url"] ?? ""),
    String(r["category"]),
    String(r["subcategory"] ?? ""),
    Number(r["sort_order"] ?? 0),
    String(r["id"]),
    PRICING.has(String(r["pricing_model"])) ? String(r["pricing_model"]) : "",
    parseTags(r["tags"]),
  ];
  const also = parseTags(r["also"]);
  if (also.length) t[9] = also;
  return t;
};
const PUBLISHED_CATEGORIES =
  "SELECT slug, name FROM categories WHERE status = 'published' ORDER BY sort_order, name";
const categoryLinks = (rs: Row[]): CategoryLink[] =>
  rs.map((r) => ({ slug: String(r["slug"]), name: String(r["name"]) }));
const byDisplayOrder = (a: IndexTool, b: IndexTool) =>
  a[5] - b[5] || (a[6] < b[6] ? -1 : a[6] > b[6] ? 1 : 0);

/** The full index, from a D1 snapshot (used by the pre-render). */
export async function searchIndexFromDb(db: D1DatabaseLike): Promise<SearchIndex> {
  const [cats, tools] = await Promise.all([
    rows(db, PUBLISHED_CATEGORIES),
    rows(
      db,
      `SELECT ${COLUMNS} FROM tools t JOIN categories c ON c.id = t.category_id WHERE ${PUBLIC} ORDER BY t.sort_order, t.id`,
    ),
  ]);
  return { categories: categoryLinks(cats), tools: tools.map(toIndexTool) };
}

/**
 * The searchable list now: the index with the changes since `snapshotAt` applied. `hidden` are the tools the gate's
 * freshness check found hidden since the build (it includes deletions, which have no row left to read).
 */
export async function searchListSince(
  db: D1DatabaseLike,
  index: SearchIndex,
  snapshotAt: string,
  hidden: Set<string>,
): Promise<SearchList> {
  const [cats, changed, viaCategory] = await Promise.all([
    rows(db, PUBLISHED_CATEGORIES),
    rows(
      db,
      `SELECT ${COLUMNS}, CASE WHEN ${PUBLIC} THEN 1 ELSE 0 END AS pub
         FROM tools t JOIN categories c ON c.id = t.category_id WHERE ${ANY_STATUS} AND t.updated_at > ?`,
      snapshotAt,
    ),
    rows(
      db,
      `SELECT ${COLUMNS}, CASE WHEN ${PUBLIC} THEN 1 ELSE 0 END AS pub
         FROM tools t JOIN categories c ON c.id = t.category_id
        WHERE t.category_id IN (SELECT id FROM categories WHERE updated_at > ?)`,
      snapshotAt,
    ),
  ]);
  const categories = categoryLinks(cats);
  const live = new Set(categories.map((c) => c.slug));
  // Keyed by tool id, not slug, so a renamed tool replaces its old entry instead of appearing twice.
  const now = new Map<string, IndexTool | null>(); // id -> current row, or null when not public now
  for (const r of [...changed, ...viaCategory])
    now.set(String(r["id"]), Number(r["pub"]) === 1 ? toIndexTool(r) : null);
  const tools: IndexTool[] = [];
  for (const t of index.tools) if (!hidden.has(t[0]) && !now.has(t[6])) tools.push(t);
  for (const t of now.values()) if (t && !hidden.has(t[0])) tools.push(t);
  return {
    categories,
    tools: tools.filter((t) => live.has(t[3])).sort(byDisplayOrder),
  };
}

/** One page of results, in the shape /api/search has always returned (ToolsPageData). */
export function searchPage(list: SearchList, query: ToolsQuery, pageSize: number): ToolsPageData {
  const names = new Map(list.categories.map((c) => [c.slug, c.name]));
  const base = { ...query, pageSize, categories: list.categories };
  if (query.category && !names.has(query.category)) return { ...base, items: [], total: 0 };
  const q = query.q;
  const matching = list.tools.filter(
    (t) =>
      (!query.category || t[3] === query.category || (t[9] ?? []).includes(query.category)) &&
      (query.pricing === "all" || t[7] === query.pricing) &&
      (!query.tag || (t[8] ?? []).some((x) => tagSlug(x) === query.tag)) &&
      (!q || t[1].toLowerCase().includes(q) || t[4].toLowerCase().includes(q) || t[2].includes(q)),
  );
  const start = (query.page - 1) * pageSize;
  const items = matching.slice(start, start + pageSize).map((t): PublicTool => ({
    slug: t[0],
    name: t[1],
    url: t[2],
    category: names.get(t[3]) ?? "",
    categorySlug: t[3],
    subcategory: t[4],
    ...(t[7] && PRICING.has(t[7]) ? { pricing: t[7] as PublicTool["pricing"] & string } : {}),
    ...(t[8]?.length ? { tags: t[8] } : {}),
  }));
  return { ...base, items, total: matching.length };
}

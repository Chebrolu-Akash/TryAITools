// SERVER ONLY. Public pages read D1 with small, indexed queries: never the whole catalogue (Workers Free plan ~10 ms CPU).
//
//   tool page       the tool + the tools sharing its category or subcategory (<= ~250 rows) + the category list
//   category page   that category's tools (<= ~230 rows)
//   /tools          one page of 48; a search also returns its total via a window function
//   home, summary,  aggregates / a few rows, cached per isolate by meta.catalog_version (versioned-cache.ts)
//   sitemap
//
// Visibility: every tool query includes PUBLIC_TOOLS (published, not flagged, in a published category). Drafts, review,
// archived and flagged tools never leave the database. Indexes: migrations/0003_public_indexes.sql.
//
// Errors: cached results fall back to the last good value from D1; per-page reads rethrow (the page fails with an error
// rather than showing tools.json rows that an admin may have unpublished).
import { FEATURED_NAMES, featuredFrom } from "@/lib/featured";
import type { D1DatabaseLike } from "@/lib/db/types";
import {
  buildCatalog,
  type PublicCategory,
  type PublicTool,
  type SourceTool,
  type ToolCopy,
} from "./model";
import { cachedByVersion, lastGood, takeTicket } from "./versioned-cache";
import {
  PAGE_SIZE,
  toolPageOf,
  type BrowseCategory,
  type BrowseData,
  type CategoryPageData,
  type SiteSummary,
  type SitemapData,
  type ToolPageData,
  type ToolsPageData,
  type ToolsQuery,
} from "./views";

/** The one visibility rule. `t` is the tools alias; categories are checked through an indexed subquery. */
export const PUBLIC_TOOLS =
  "t.status = 'published' AND t.needs_review = 0 AND t.category_id IN (SELECT id FROM categories WHERE status = 'published')";
const TOOL_COLUMNS =
  "t.slug, t.name, COALESCE(t.url, '') AS url, t.category_id, COALESCE(t.subcategory, '') AS subcategory, t.indexing";
const ORDER = "ORDER BY t.sort_order, t.id";

type Row = Record<string, unknown>;
type PublicCategoryRow = PublicCategory & { id: string };

const parseList = (v: unknown): string[] | null => {
  if (typeof v !== "string") return null;
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function createD1Reader(db: D1DatabaseLike) {
  const all = async (sql: string, ...params: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...params)
        .all<Row>()
    ).results;
  const first = (sql: string, ...params: unknown[]) =>
    db
      .prepare(sql)
      .bind(...params)
      .first<Row>();

  /** Ticket first, then the version row: see versioned-cache.ts. */
  async function version() {
    const ticket = takeTicket();
    const row = await first("SELECT value FROM meta WHERE key = 'catalog_version'");
    return { ticket, version: String(row?.["value"] ?? "") };
  }
  /** A cached result for the current version; on any D1 error, the last good value if there is one. */
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    try {
      const v = await version();
      return await cachedByVersion(key, v.version, v.ticket, load);
    } catch (e) {
      const prev = lastGood<T>(key);
      if (prev !== undefined) {
        console.error(
          `catalog: D1 read failed, serving last good ${key}`,
          e instanceof Error ? e.message : e,
        );
        return prev;
      }
      throw e;
    }
  }

  const categories = () =>
    cached("categories", async () =>
      (
        await all(
          "SELECT id, slug, name, subcategories FROM categories WHERE status = 'published' ORDER BY sort_order, name",
        )
      ).map((c): PublicCategoryRow => ({
        id: String(c["id"]),
        slug: String(c["slug"]),
        name: String(c["name"]),
        subcategories: parseList(c["subcategories"]) ?? [],
      })),
    );

  const toPublicTool = (r: Row, byId: Map<string, PublicCategoryRow>): PublicTool | null => {
    const cat = byId.get(String(r["category_id"]));
    if (!cat) return null; // category unpublished between two reads: treat as not public
    return {
      slug: String(r["slug"]),
      name: String(r["name"]),
      url: String(r["url"] ?? ""),
      category: cat.name,
      categorySlug: cat.slug,
      subcategory: String(r["subcategory"] ?? ""),
    };
  };
  const toolsFrom = (rows: Row[], cats: PublicCategoryRow[]) => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    return rows.map((r) => toPublicTool(r, byId)).filter((t): t is PublicTool => t !== null);
  };
  const link = ({ name, slug }: PublicCategoryRow) => ({ name, slug });

  /** Public tool count per (category, subcategory); cached, shared by summary, home and /tools totals. */
  const counts = () =>
    cached("counts", async () =>
      (
        await all(
          `SELECT t.category_id AS c, COALESCE(t.subcategory, '') AS s, count(*) AS n FROM tools t WHERE ${PUBLIC_TOOLS} GROUP BY 1, 2`,
        )
      ).map((r) => ({ c: String(r["c"]), s: String(r["s"]), n: Number(r["n"]) })),
    );

  async function summary(): Promise<SiteSummary> {
    const [cats, cnt] = await Promise.all([categories(), counts()]);
    const ids = new Set(cats.map((c) => c.id));
    return {
      toolCount: cnt.reduce((sum, r) => sum + (ids.has(r.c) ? r.n : 0), 0),
      categories: cats.map(link),
    };
  }

  const browse = (): Promise<BrowseData> =>
    cached("browse", async () => {
      const [cats, cnt, previews, featuredRows] = await Promise.all([
        categories(),
        counts(),
        all(
          `SELECT slug, name, url, category_id, subcategory FROM (
             SELECT ${TOOL_COLUMNS}, row_number() OVER (PARTITION BY t.category_id, COALESCE(t.subcategory, '') ${ORDER}) AS rn
               FROM tools t WHERE ${PUBLIC_TOOLS}) WHERE rn <= 3 ORDER BY category_id, subcategory, rn`,
        ),
        all(
          `SELECT ${TOOL_COLUMNS} FROM tools t WHERE ${PUBLIC_TOOLS} AND t.name IN (${FEATURED_NAMES.map(() => "?").join(", ")}) ${ORDER}`,
          ...FEATURED_NAMES,
        ),
      ]);
      const n = new Map(cnt.map((r) => [`${r.c}\u0000${r.s}`, r.n]));
      const pv = new Map<string, Row[]>();
      for (const r of previews) {
        const k = `${String(r["category_id"])}\u0000${String(r["subcategory"] ?? "")}`;
        pv.set(k, [...(pv.get(k) ?? []), r]);
      }
      const categoriesOut = cats.map((cat): BrowseCategory => ({
        name: cat.name,
        slug: cat.slug,
        toolCount: cnt.filter((r) => r.c === cat.id).reduce((s, r) => s + r.n, 0),
        subcategories: cat.subcategories.map((sub) => ({
          name: sub,
          count: n.get(`${cat.id}\u0000${sub}`) ?? 0,
          preview: (pv.get(`${cat.id}\u0000${sub}`) ?? []).map((r) => ({
            slug: String(r["slug"]),
            name: String(r["name"]),
            url: String(r["url"] ?? ""),
          })),
        })),
      }));
      const ids = new Set(cats.map((c) => c.id));
      return {
        toolCount: cnt.reduce((s, r) => s + (ids.has(r.c) ? r.n : 0), 0),
        categories: categoriesOut,
        featured: featuredFrom(toolsFrom(featuredRows, cats)),
      };
    });

  async function toolsPage(query: ToolsQuery): Promise<ToolsPageData> {
    const cats = await categories();
    const cat = query.category ? cats.find((c) => c.slug === query.category) : undefined;
    const base = { ...query, pageSize: PAGE_SIZE, categories: cats.map(link) };
    if (query.category && !cat) return { ...base, items: [], total: 0 };
    const offset = (query.page - 1) * PAGE_SIZE;
    const where = [PUBLIC_TOOLS];
    const params: unknown[] = [];
    if (cat) {
      where.push("t.category_id = ?");
      params.push(cat.id);
    }
    if (!query.q) {
      // No search: the total is the cached count, and the page is a LIMIT on the display-order index.
      const load = async () => {
        const [cnt, rows] = await Promise.all([
          counts(),
          all(
            `SELECT ${TOOL_COLUMNS} FROM tools t WHERE ${where.join(" AND ")} ${ORDER} LIMIT ? OFFSET ?`,
            ...params,
            PAGE_SIZE,
            offset,
          ),
        ]);
        const ids = new Set(cats.map((c) => c.id));
        const total = cnt.reduce(
          (s, r) => s + ((cat ? r.c === cat.id : ids.has(r.c)) ? r.n : 0),
          0,
        );
        return { ...base, items: toolsFrom(rows, cats), total };
      };
      return !cat && query.page === 1 ? cached("tools:first-page", load) : load();
    }
    where.push(
      "(instr(lower(t.name), ?) > 0 OR instr(lower(COALESCE(t.subcategory, '')), ?) > 0 OR instr(COALESCE(t.url, ''), ?) > 0)",
    );
    params.push(query.q, query.q, query.q);
    const rows = await all(
      `SELECT ${TOOL_COLUMNS}, count(*) OVER () AS total FROM tools t WHERE ${where.join(" AND ")} ${ORDER} LIMIT ? OFFSET ?`,
      ...params,
      PAGE_SIZE,
      offset,
    );
    let total = Number(rows[0]?.["total"] ?? 0);
    if (rows.length === 0 && offset > 0) {
      // Past the last page: the window total is only on returned rows, so count separately (rare).
      const c = await first(
        `SELECT count(*) AS n FROM tools t WHERE ${where.join(" AND ")}`,
        ...params,
      );
      total = Number(c?.["n"] ?? 0);
    }
    return { ...base, items: toolsFrom(rows, cats), total };
  }

  async function categoryPage(slug: string): Promise<CategoryPageData | null> {
    const cats = await categories();
    const cat = cats.find((c) => c.slug === slug);
    if (!cat) return null;
    const rows = await all(
      `SELECT ${TOOL_COLUMNS} FROM tools t WHERE t.category_id = ? AND ${PUBLIC_TOOLS} ${ORDER}`,
      cat.id,
    );
    const { id: _id, ...category } = cat;
    return { category, tools: toolsFrom(rows, cats) };
  }

  /** The tool page, a redirect target for a retired slug, or null (404). */
  async function toolPage(slug: string): Promise<ToolPageData | { redirect: string } | null> {
    const cats = await categories();
    const row = await first(
      `SELECT ${TOOL_COLUMNS}, t.tagline, t.overview, t.best_for, t.features, t.pros, t.limits, t.steps, t.tips,
              t.seo_title, t.seo_description, t.content_source
         FROM tools t WHERE t.slug = ? AND ${PUBLIC_TOOLS}`,
      slug,
    );
    if (!row || !cats.some((c) => c.id === String(row["category_id"]))) {
      const r = await first(
        `SELECT t.slug FROM tool_redirects r JOIN tools t ON t.id = r.tool_id WHERE r.old_slug = ? AND ${PUBLIC_TOOLS}`,
        slug,
      );
      return r ? { redirect: String(r["slug"]) } : null;
    }
    const sub = String(row["subcategory"] ?? "");
    // Alternatives draw from the same subcategory (in ANY category: two subcategory names are shared) and then the same
    // category; related tools come from the same category. These rows are all the page's rules can ever look at.
    const neighbours = await all(
      `SELECT ${TOOL_COLUMNS} FROM tools t
        WHERE (t.category_id = ? OR t.subcategory = ? OR (? = '' AND t.subcategory IS NULL)) AND ${PUBLIC_TOOLS} ${ORDER}`,
      row["category_id"],
      sub,
      sub,
    );
    const byId = new Map(cats.map((c) => [c.id, c]));
    const local = buildCatalog({
      source: "d1",
      categories: cats.map(({ id: _id, ...c }) => c),
      tools: neighbours.flatMap((r): SourceTool[] => {
        const t = toPublicTool(r, byId);
        return t ? [{ ...t, indexing: r["indexing"] === "index" ? "index" : "noindex" }] : [];
      }),
    });
    const tool = local.bySlug.get(slug);
    if (!tool) return null;
    // Best-for, steps and tips are category guidance. Earlier imports stored the PRIMARY listing's template text on every
    // listing of a product, so they are honoured only once an admin has edited the tool (content_source = 'admin');
    // otherwise each listing gets its own category's template, exactly like the JSON site.
    const edited = row["content_source"] === "admin";
    const copy: ToolCopy = {
      tagline: str(row["tagline"]),
      overview: str(row["overview"]),
      bestFor: edited ? str(row["best_for"]) : null,
      features: parseList(row["features"]),
      pros: parseList(row["pros"]),
      limits: parseList(row["limits"]),
      steps: edited ? parseList(row["steps"]) : null,
      tips: edited ? parseList(row["tips"]) : null,
      seoTitle: str(row["seo_title"]),
      seoDescription: str(row["seo_description"]),
    };
    return toolPageOf(local, tool, copy);
  }

  const sitemap = (): Promise<SitemapData> =>
    cached("sitemap", async () => {
      const [cats, rows] = await Promise.all([
        categories(),
        all(`SELECT t.slug FROM tools t WHERE ${PUBLIC_TOOLS} AND t.indexing = 'index' ${ORDER}`),
      ]);
      return {
        categorySlugs: cats.map((c) => c.slug),
        toolSlugs: rows.map((r) => String(r["slug"])),
      };
    });

  return { source: "d1" as const, summary, browse, toolsPage, categoryPage, toolPage, sitemap };
}

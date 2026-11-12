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
import { pricingOf } from "@/lib/pricing";
import { readPricingPlans, type ToolPricing } from "@/lib/pricing-plans";
import { tagFromSlug, tagsOf } from "@/lib/tags";
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
  type CategoryLanding,
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
  "t.slug, t.name, COALESCE(t.url, '') AS url, t.category_id, COALESCE(t.subcategory, '') AS subcategory, t.indexing, t.pricing_model, t.tags";
const ORDER = "ORDER BY t.sort_order, t.id";
/**
 * Shared category memberships (tool_categories, migration 0010): a public tool also listed on another category page, as a
 * "virtual row" with that category and the membership's subcategory. Its URL and page stay those of the one tool.
 */
const MEMBER_COLUMNS =
  "t.slug, t.name, COALESCE(t.url, '') AS url, m.category_id AS category_id, COALESCE(m.subcategory, '') AS subcategory, t.indexing, t.pricing_model, t.tags";
const MEMBER_FROM = `tool_categories m JOIN tools t ON t.id = m.tool_id WHERE ${"t.status = 'published' AND t.needs_review = 0 AND t.category_id IN (SELECT id FROM categories WHERE status = 'published')"} AND m.category_id IN (SELECT id FROM categories WHERE status = 'published')`;
/** A database from before migration 0010 has no tool_categories table: memberships are simply none there. */
const noMembershipTable = (e: unknown) =>
  /no such table:? tool_categories/i.test(e instanceof Error ? e.message : String(e));

type Row = Record<string, unknown>;
type PublicCategoryRow = PublicCategory & { id: string; indexable: boolean };

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
          "SELECT id, slug, name, subcategories, indexing FROM categories WHERE status = 'published' ORDER BY sort_order, name",
        )
      ).map((c): PublicCategoryRow => ({
        id: String(c["id"]),
        slug: String(c["slug"]),
        name: String(c["name"]),
        subcategories: parseList(c["subcategories"]) ?? [],
        // anything but an explicit 'noindex' stays indexable (the column defaults to 'index')
        indexable: c["indexing"] !== "noindex",
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
      ...(pricingOf(r["pricing_model"]) ? { pricing: pricingOf(r["pricing_model"])! } : {}),
      ...(tagsOf(r["tags"]).length ? { tags: tagsOf(r["tags"]) } : {}),
    };
  };
  const toolsFrom = (rows: Row[], cats: PublicCategoryRow[]) => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    return rows.map((r) => toPublicTool(r, byId)).filter((t): t is PublicTool => t !== null);
  };
  const link = ({ name, slug }: PublicCategoryRow) => ({ name, slug });

  /**
   * Every public tool in display order: ONE scan of idx_tools_public_order (about one row read per public tool), cached per
   * catalogue version. Counts, subcategory previews and featured tools are derived from it in memory; as separate
   * aggregate queries (GROUP BY, a window function, a name filter) they read about 7 times as many rows (measured:
   * 16,234 vs 2,241), which every isolate paid again after each Admin change.
   */
  const publicList = () =>
    cached("public-list", () =>
      all(`SELECT ${TOOL_COLUMNS} FROM tools t WHERE ${PUBLIC_TOOLS} ${ORDER}`),
    );
  /** Every membership row of a public tool, in display order (cached per catalogue version). */
  const memberList = () =>
    cached("member-list", async () => {
      try {
        return await all(`SELECT ${MEMBER_COLUMNS} FROM ${MEMBER_FROM} ${ORDER}`);
      } catch (e) {
        if (noMembershipTable(e)) return [] as Row[];
        throw e;
      }
    });
  const countsOf = new WeakMap<Row[], { c: string; s: string; n: number }[]>();
  /** Public tool count per (category, subcategory); shared by summary, home and /tools totals. */
  const counts = async () => {
    const [list, members] = await Promise.all([publicList(), memberList()]);
    let out = countsOf.get(list);
    if (!out) {
      const n = new Map<string, { c: string; s: string; n: number }>();
      for (const r of [...list, ...members]) {
        const c = String(r["category_id"]);
        const s = String(r["subcategory"] ?? "");
        const k = `${c}\u0000${s}`;
        const e = n.get(k);
        if (e) e.n++;
        else n.set(k, { c, s, n: 1 });
      }
      out = [...n.values()];
      countsOf.set(list, out);
    }
    return out;
  };

  /** The public tool count alone: one row back, because the summary is read on every server-rendered page. */
  const publicCount = () =>
    cached("public-count", async () =>
      Number((await first(`SELECT count(*) AS n FROM tools t WHERE ${PUBLIC_TOOLS}`))?.["n"] ?? 0),
    );

  async function summary(): Promise<SiteSummary> {
    const [cats, toolCount] = await Promise.all([categories(), publicCount()]);
    return { toolCount, categories: cats.map(link) };
  }

  const browse = (): Promise<BrowseData> =>
    cached("browse", async () => {
      const [cats, cnt, list, members] = await Promise.all([
        categories(),
        counts(),
        publicList(),
        memberList(),
      ]);
      const n = new Map(cnt.map((r) => [`${r.c}\u0000${r.s}`, r.n]));
      // The first 3 tools of each (category, subcategory) in display order, and the featured names, from the same list.
      const pv = new Map<string, Row[]>();
      const featuredNames = new Set<string>(FEATURED_NAMES);
      const featuredRows: Row[] = [];
      for (const r of list) {
        const k = `${String(r["category_id"])}\u0000${String(r["subcategory"] ?? "")}`;
        const p = pv.get(k) ?? [];
        if (p.length < 3) pv.set(k, [...p, r]);
        if (featuredNames.has(String(r["name"]))) featuredRows.push(r);
      }
      for (const r of members) {
        const k = `${String(r["category_id"])}\u0000${String(r["subcategory"] ?? "")}`;
        const p = pv.get(k) ?? [];
        if (p.length < 3) pv.set(k, [...p, r]);
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
        // each tool once (memberships are extra listings of the same tools)
        toolCount: list.filter((r) => ids.has(String(r["category_id"]))).length,
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
    const withMembers = cat ? await memberList().then((m) => m.length > 0) : false;
    if (cat) {
      if (withMembers) {
        where.push(
          "(t.category_id = ? OR t.id IN (SELECT tool_id FROM tool_categories WHERE category_id = ?))",
        );
        params.push(cat.id, cat.id);
      } else {
        where.push("t.category_id = ?");
        params.push(cat.id);
      }
    }
    if (!query.q && query.pricing === "all" && !query.tag) {
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
        const total = cat
          ? cnt.reduce((s, r) => s + (r.c === cat.id ? r.n : 0), 0)
          : (await publicList()).filter((r) => ids.has(String(r["category_id"]))).length;
        return { ...base, items: toolsFrom(rows, cats), total };
      };
      return !cat && query.page === 1 ? cached("tools:first-page", load) : load();
    }
    if (query.q) {
      where.push(
        "(instr(lower(t.name), ?) > 0 OR instr(lower(COALESCE(t.subcategory, '')), ?) > 0 OR instr(COALESCE(t.url, ''), ?) > 0)",
      );
      params.push(query.q, query.q, query.q);
    }
    if (query.pricing !== "all") {
      where.push("t.pricing_model = ?");
      params.push(query.pricing);
    }
    const tag = tagFromSlug(query.tag);
    if (tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)");
      params.push(tag);
    }
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
    const [rows, cnt] = await Promise.all([
      (async () => {
        try {
          return await all(
            `SELECT * FROM (
               SELECT ${TOOL_COLUMNS}, t.sort_order AS so, t.id AS tid FROM tools t WHERE t.category_id = ? AND ${PUBLIC_TOOLS}
               UNION ALL
               SELECT ${MEMBER_COLUMNS}, t.sort_order AS so, t.id AS tid FROM ${MEMBER_FROM} AND m.category_id = ?
             ) ORDER BY so, tid`,
            cat.id,
            cat.id,
          );
        } catch (e) {
          if (!noMembershipTable(e)) throw e;
          return all(
            `SELECT ${TOOL_COLUMNS} FROM tools t WHERE t.category_id = ? AND ${PUBLIC_TOOLS} ${ORDER}`,
            cat.id,
          );
        }
      })(),
      counts(), // the category sidebar's counts (cached per catalogue version, shared with home and /tools)
    ]);
    const [landing, list] = await Promise.all([landingOf(cat.id), publicList()]);
    const { id: _id, indexable, ...category } = cat;
    const ids = new Set(cats.map((c) => c.id));
    const picked = new Set<string>();
    const pickRows = rows.filter((r) => {
      const s = String(r["slug"]);
      if (r["indexing"] !== "index" || picked.has(s)) return false;
      picked.add(s);
      return true;
    });
    return {
      category,
      indexable,
      tools: toolsFrom(rows, cats),
      topPicks: toolsFrom(pickRows.slice(0, 8), cats),
      totalTools: list.filter((r) => ids.has(String(r["category_id"]))).length,
      landing,
      categories: cats.map((c) => ({
        name: c.name,
        slug: c.slug,
        toolCount: cnt.reduce((s, r) => s + (r.c === c.id ? r.n : 0), 0),
      })),
    };
  }

  /** The landing copy of a category; a database from before migration 0010 has no intro/faqs columns. */
  async function landingOf(categoryId: string): Promise<CategoryLanding> {
    const none: CategoryLanding = { seoTitle: null, seoDescription: null, intro: null, faqs: [] };
    try {
      const r = await first(
        "SELECT seo_title, seo_description, intro, faqs FROM categories WHERE id = ?",
        categoryId,
      );
      if (!r) return none;
      let faqs: { q: string; a: string }[] = [];
      try {
        const x: unknown = JSON.parse(String(r["faqs"] ?? "[]"));
        if (Array.isArray(x))
          faqs = x.filter(
            (f): f is { q: string; a: string } =>
              !!f && typeof f.q === "string" && typeof f.a === "string",
          );
      } catch {
        faqs = [];
      }
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      return {
        seoTitle: str(r["seo_title"]),
        seoDescription: str(r["seo_description"]),
        intro: str(r["intro"]),
        faqs,
      };
    } catch (e) {
      if (/no such column/i.test(e instanceof Error ? e.message : String(e))) return none;
      throw e;
    }
  }

  /** The tool page, a redirect target for a retired slug, or null (404). */
  async function toolPage(slug: string): Promise<ToolPageData | { redirect: string } | null> {
    const cats = await categories();
    const row = await first(
      `SELECT ${TOOL_COLUMNS}, t.tagline, t.overview, t.best_for, t.features, t.pros, t.limits, t.steps, t.tips,
              t.seo_title, t.seo_description, t.content_source, t.pricing_plans, t.pricing_source,
              t.pricing_checked_at
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
      categories: cats.map(({ id: _id, indexable: _ix, ...c }) => c),
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
    const plans = readPricingPlans(row["pricing_plans"]);
    const source = str(row["pricing_source"]);
    const checked = str(row["pricing_checked_at"]);
    const pricing: ToolPricing | null = plans
      ? {
          plans,
          sourceUrl: source && /^https:\/\/[^\s]+$/.test(source) ? source : null,
          checkedAt: checked && /^\d{4}-\d{2}-\d{2}$/.test(checked) ? checked : null,
        }
      : null;
    return toolPageOf(local, tool, copy, pricing);
  }

  const sitemap = (): Promise<SitemapData> =>
    cached("sitemap", async () => {
      const [cats, rows] = await Promise.all([
        categories(),
        all(`SELECT t.slug FROM tools t WHERE ${PUBLIC_TOOLS} AND t.indexing = 'index' ${ORDER}`),
      ]);
      return {
        categorySlugs: cats.filter((c) => c.indexable).map((c) => c.slug),
        toolSlugs: rows.map((r) => String(r["slug"])),
      };
    });

  return { source: "d1" as const, summary, browse, toolsPage, categoryPage, toolPage, sitemap };
}

// Page data shapes and pure builders over an in-memory Catalog. The tools.json fallback builds every page with these;
// the D1 reader builds tool and category pages with them too, on a small Catalog holding only the rows that page needs,
// so the alternatives / related / content rules are literally the same code on both paths.
import { featuredFrom, type FeaturedTool } from "@/lib/featured";
import type { ToolContent } from "@/lib/tool-content";
import {
  toPublic,
  type Catalog,
  type CatalogTool,
  type PublicCategory,
  type PublicTool,
  type ToolCopy,
} from "./model";

export const PAGE_SIZE = 48;
export const MAX_PAGE = 1000;
export const MAX_QUERY = 100;

export type CategoryLink = { name: string; slug: string };
export type SiteSummary = { toolCount: number; categories: CategoryLink[] };
export type BrowseCategory = {
  name: string;
  slug: string;
  toolCount: number;
  subcategories: {
    name: string;
    count: number;
    preview: Pick<PublicTool, "slug" | "name" | "url">[];
  }[];
};
export type BrowseData = {
  toolCount: number;
  categories: BrowseCategory[];
  featured: FeaturedTool[];
};
export type ToolsQuery = { q: string; category: string; page: number };
export type ToolsPageData = ToolsQuery & {
  items: PublicTool[];
  total: number;
  pageSize: number;
  categories: CategoryLink[];
};
export type CategoryPageData = { category: PublicCategory; tools: PublicTool[] };
export type ToolPageData = {
  tool: PublicTool;
  content: ToolContent;
  indexable: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  alternatives: PublicTool[];
  related: PublicTool[];
  relatedCategories: CategoryLink[];
};
export type SitemapData = { categorySlugs: string[]; toolSlugs: string[] };

const link = ({ name, slug }: CategoryLink): CategoryLink => ({ name, slug });

/** Search is case-insensitive on name and subcategory, and a plain substring match on the URL (as it always was). */
export function normalizeToolsQuery(input: Partial<ToolsQuery>): ToolsQuery {
  const page = Number(input.page);
  return {
    q: String(input.q ?? "")
      .trim()
      .toLowerCase()
      .slice(0, MAX_QUERY),
    category: String(input.category ?? "").slice(0, 80),
    page: Number.isInteger(page) ? Math.min(MAX_PAGE, Math.max(1, page)) : 1,
  };
}
export const matchesQuery = (t: PublicTool, q: string) =>
  !q ||
  t.name.toLowerCase().includes(q) ||
  t.subcategory.toLowerCase().includes(q) ||
  t.url.includes(q);

export const summaryOf = (c: Catalog): SiteSummary => ({
  toolCount: c.tools.length,
  categories: c.categories.map(link),
});

export function browseOf(c: Catalog): BrowseData {
  const categories = c.categories.map((cat): BrowseCategory => {
    const inCat = c.toolsIn(cat.name);
    return {
      name: cat.name,
      slug: cat.slug,
      toolCount: inCat.length,
      subcategories: cat.subcategories.map((sub) => {
        const list = inCat.filter((t) => t.subcategory === sub);
        return {
          name: sub,
          count: list.length,
          preview: list.slice(0, 3).map(({ slug, name, url }) => ({ slug, name, url })),
        };
      }),
    };
  });
  return { toolCount: c.tools.length, categories, featured: featuredFrom(c.tools) };
}

export function toolsPageOf(c: Catalog, query: ToolsQuery): ToolsPageData {
  const cat = query.category ? c.categoryBySlug(query.category) : undefined;
  const matching =
    query.category && !cat
      ? []
      : c.tools.filter((t) => (!cat || t.category === cat.name) && matchesQuery(t, query.q));
  const start = (query.page - 1) * PAGE_SIZE;
  return {
    ...query,
    items: matching.slice(start, start + PAGE_SIZE).map(toPublic),
    total: matching.length,
    pageSize: PAGE_SIZE,
    categories: c.categories.map(link),
  };
}

export function categoryPageOf(c: Catalog, slug: string): CategoryPageData | null {
  const category = c.categoryBySlug(slug);
  return category ? { category, tools: c.toolsIn(category.name).map(toPublic) } : null;
}

export function toolPageOf(c: Catalog, tool: CatalogTool, copy: ToolCopy | null): ToolPageData {
  const alternatives = c.alternativesFor(tool, 6);
  return {
    tool: toPublic(tool),
    content: c.contentOf(tool, copy),
    indexable: tool.indexable,
    seoTitle: copy?.seoTitle ?? null,
    seoDescription: copy?.seoDescription ?? null,
    alternatives: alternatives.map(toPublic),
    related: c.relatedTools(tool, alternatives, 4).map(toPublic),
    relatedCategories: c.relatedCategories(tool.category, 4).map(link),
  };
}

export const sitemapOf = (c: Catalog): SitemapData => ({
  categorySlugs: c.categories.map((x) => x.slug),
  toolSlugs: c.indexableSlugs(),
});

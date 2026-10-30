// The public catalogue as one immutable object, built from whichever source is live (D1, or tools.json as fallback).
// Pure functions only: no I/O, no globals. The slug, alternative, related-tool and indexing rules are the ones the site
// has always used (originally in src/lib/tool-pages.ts); src/test/catalog.test.ts proves they give identical results
// for tools.json, so URLs and SEO do not change when the source switches to D1.
import { contentFor, curatedKey, hasCuratedContent, type ToolContent } from "@/lib/tool-content";
import { domainOf } from "@/lib/tool-utils";

/** What browsers receive for a tool card or list row. */
export type PublicTool = {
  slug: string;
  name: string;
  url: string;
  category: string;
  categorySlug: string;
  subcategory: string;
};
export type PublicCategory = { name: string; slug: string; subcategories: string[] };

/** Admin-editable copy stored in D1. Null/empty fields fall back to the category template. */
export type ToolCopy = {
  tagline?: string | null;
  overview?: string | null;
  bestFor?: string | null;
  features?: string[] | null;
  pros?: string[] | null;
  limits?: string[] | null;
  steps?: string[] | null;
  tips?: string[] | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type SourceTool = {
  name: string;
  url: string;
  category: string;
  subcategory: string;
  /** Stored slug (D1). When absent (tools.json) it is derived exactly as the site always has. */
  slug?: string | undefined;
  /** Stored indexing decision (D1). When absent it is derived from curated content, as before. */
  indexing?: "index" | "noindex" | undefined;
  copy?: ToolCopy | undefined;
};

export type CatalogTool = PublicTool & { indexable: boolean; copy: ToolCopy | null };
export type CatalogSource = "d1" | "json";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const shortCategory = (categorySlug: string) =>
  categorySlug.replace(/^ai-/, "").replace(/-tools$/, "");
const keyOf = (t: PublicTool) => domainOf(t.url) || t.name.toLowerCase();

export const toPublic = (t: CatalogTool): PublicTool => ({
  slug: t.slug,
  name: t.name,
  url: t.url,
  category: t.category,
  categorySlug: t.categorySlug,
  subcategory: t.subcategory,
});

/** Rows with a placeholder name or no real website (e.g. "Tool Name" / https://Website) are never suggested. */
export const isSuggestable = (t: PublicTool) =>
  domainOf(t.url).includes(".") && !/^tool name$/i.test(t.name.trim());

export function buildCatalog(input: {
  source: CatalogSource;
  categories: PublicCategory[];
  tools: SourceTool[];
}) {
  const categories = input.categories;
  const catSlugByName = new Map(categories.map((c) => [c.name, c.slug]));

  // Slugs: stored ones win; otherwise first tool with a name gets the plain slug, later ones the category suffix.
  const bySlug = new Map<string, CatalogTool>();
  const tools: CatalogTool[] = [];
  for (const t of input.tools) {
    const categorySlug = catSlugByName.get(t.category);
    if (!categorySlug) continue; // a tool whose category is not public is not public either
    let slug = t.slug ?? "";
    if (!slug) {
      const base = slugify(t.name) || "tool";
      const suffix = shortCategory(categorySlug);
      slug = base;
      if (bySlug.has(slug)) slug = `${base}-${suffix}`.replace(/-$/, "");
      for (let n = 2; bySlug.has(slug); n++) slug = `${base}-${suffix}-${n}`.replace(/--+/g, "-");
    }
    if (bySlug.has(slug)) continue; // D1 slugs are UNIQUE; this only guards against bad input
    const tool: CatalogTool = {
      slug,
      name: t.name,
      url: t.url ?? "",
      category: t.category,
      categorySlug,
      subcategory: t.subcategory ?? "",
      indexable: false,
      copy: t.copy ?? null,
    };
    tools.push(tool);
    bySlug.set(slug, tool);
  }

  // Indexing: D1 stores the decision; tools.json derives it (first curated listing of each product).
  const stored = input.tools.some((t) => t.indexing !== undefined);
  if (stored) {
    const indexing = new Map(input.tools.map((t) => [t.slug, t.indexing]));
    for (const t of tools) t.indexable = indexing.get(t.slug) === "index";
  } else {
    const seen = new Set<string>();
    for (const t of tools) {
      const legacy = { id: t.slug, ...toPublic(t) };
      if (!hasCuratedContent(legacy)) continue;
      const key = curatedKey(legacy);
      if (seen.has(key)) continue;
      seen.add(key);
      t.indexable = true;
    }
  }
  const primaries = tools.filter((t) => t.indexable);

  const toolsIn = (categoryName: string) => tools.filter((t) => t.category === categoryName);

  /** Other tools in the same subcategory (then category), skipping the same product/domain. */
  function alternativesFor(tool: CatalogTool, limit = 6): CatalogTool[] {
    const seen = new Set<string>([keyOf(tool)]);
    const out: CatalogTool[] = [];
    const pick = (list: CatalogTool[]) => {
      for (const t of list) {
        const key = keyOf(t);
        if (t === tool || seen.has(key) || !isSuggestable(t)) continue;
        seen.add(key);
        out.push(t);
        if (out.length >= limit) break;
      }
    };
    pick(tools.filter((t) => t.subcategory === tool.subcategory));
    if (out.length < limit) pick(tools.filter((t) => t.category === tool.category));
    return out;
  }

  /** Popular, hand-reviewed tools in the same category that aren't already shown as alternatives. */
  function relatedTools(tool: CatalogTool, exclude: CatalogTool[], limit = 4): CatalogTool[] {
    const skip = new Set<CatalogTool>([tool, ...exclude]);
    const out: CatalogTool[] = [];
    for (const t of primaries) {
      if (t.category !== tool.category || skip.has(t) || !isSuggestable(t)) continue;
      if (domainOf(t.url) && domainOf(t.url) === domainOf(tool.url)) continue;
      out.push(t);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Other categories to suggest, taken from neighbours in the category list. */
  function relatedCategories(categoryName: string, limit = 4): PublicCategory[] {
    const i = categories.findIndex((c) => c.name === categoryName);
    if (i < 0) return [];
    const out: PublicCategory[] = [];
    for (let step = 1; out.length < limit && step < categories.length; step++) {
      const c = categories[(i + step) % categories.length];
      if (c && c.name !== categoryName) out.push(c);
    }
    return out;
  }

  /** Page copy: the category template / curated text as before, overridden by any copy stored in D1. */
  function contentOf(tool: CatalogTool, copy: ToolCopy | null = tool.copy): ToolContent {
    const base = contentFor({ id: tool.slug, ...toPublic(tool) });
    const c = copy;
    if (!c) return base;
    const list = (v: string[] | null | undefined) => (v && v.length ? v : null);
    const tagline = c.tagline?.trim() || null;
    const features = list(c.features);
    return {
      ...base,
      tagline: tagline ?? base.tagline,
      overview: c.overview?.trim() || (tagline ? null : base.overview),
      bestFor: c.bestFor?.trim() || base.bestFor,
      features: features ?? base.features,
      pros: list(c.pros) ?? base.pros,
      limits: list(c.limits) ?? base.limits,
      steps: list(c.steps) ?? base.steps,
      tips: list(c.tips) ?? base.tips,
      curated: base.curated || !!tagline || !!features,
    };
  }

  return {
    source: input.source,
    categories,
    tools,
    bySlug,
    categoryBySlug: (slug: string) => categories.find((c) => c.slug === slug),
    toolsIn,
    alternativesFor,
    relatedTools,
    relatedCategories,
    contentOf,
    indexableSlugs: () => primaries.map((t) => t.slug),
  };
}

export type Catalog = ReturnType<typeof buildCatalog>;

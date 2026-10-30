// Server functions the public routes call from their loaders. They run on the server (SSR and client navigations alike),
// read the live catalogue, and return only public fields: browsers never receive tools.json or any non-public row.
import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { featuredFrom } from "@/lib/featured";
import { toPublic, type PublicTool } from "./model";
import { getCatalog, redirectFor } from "./source";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugInput = (v: unknown) => {
  if (typeof v !== "string" || v.length > 120 || !SLUG.test(v)) throw notFound();
  return v;
};

/** Counts and category links for the layout, hero and about page. */
export const fetchSiteSummary = createServerFn({ method: "GET" }).handler(async () => {
  const c = await getCatalog();
  return {
    toolCount: c.tools.length,
    categories: c.categories.map(({ name, slug }) => ({ name, slug })),
  };
});

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

/** Category overview for the home page and /categories, plus the featured logo loop. */
export const fetchBrowse = createServerFn({ method: "GET" }).handler(async () => {
  const c = await getCatalog();
  const categories: BrowseCategory[] = c.categories.map((cat) => {
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
});

/** Rows for /tools as compact tuples [slug, name, url, categoryIndex, subcategory] to keep the page small. */
export type IndexRow = [string, string, string, number, string];
export const fetchToolsIndex = createServerFn({ method: "GET" }).handler(async () => {
  const c = await getCatalog();
  const index = new Map(c.categories.map((cat, i) => [cat.name, i]));
  return {
    categories: c.categories.map(({ name, slug }) => ({ name, slug })),
    rows: c.tools.map((t): IndexRow => [
      t.slug,
      t.name,
      t.url,
      index.get(t.category) ?? 0,
      t.subcategory,
    ]),
  };
});

export const fetchCategory = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data: slug }) => {
    const c = await getCatalog();
    const category = c.categoryBySlug(slug);
    if (!category) throw notFound();
    return { category, tools: c.toolsIn(category.name).map(toPublic) };
  });

export const fetchToolPage = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data: slug }) => {
    const c = await getCatalog();
    const tool = c.bySlug.get(slug);
    if (!tool) {
      const to = await redirectFor(slug, c);
      if (to) throw redirect({ to: "/tools/$slug", params: { slug: to }, statusCode: 301 });
      throw notFound();
    }
    const alternatives = c.alternativesFor(tool, 6);
    return {
      tool: toPublic(tool),
      content: c.contentOf(tool),
      indexable: tool.indexable,
      seoTitle: tool.copy?.seoTitle ?? null,
      seoDescription: tool.copy?.seoDescription ?? null,
      alternatives: alternatives.map(toPublic),
      related: c.relatedTools(tool, alternatives, 4).map(toPublic),
      relatedCategories: c.relatedCategories(tool.category, 4).map(({ name, slug }) => ({
        name,
        slug,
      })),
    };
  });

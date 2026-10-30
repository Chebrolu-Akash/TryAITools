// SERVER ONLY. The tools.json fallback, used when no D1 database is bound (production today) or D1 has never been imported.
// tools.json is imported dynamically, so the 400 KB dataset is parsed only on this path, once per isolate, never on the D1
// path. Page data is built by the same pure builders the site has always used (views.ts / model.ts).
import { buildCatalog, type Catalog, type PublicCategory, type SourceTool } from "./model";
import {
  browseOf,
  categoryPageOf,
  sitemapOf,
  summaryOf,
  toolPageOf,
  toolsPageOf,
  type ToolsQuery,
} from "./views";

let catalog: Promise<Catalog> | null = null;

/** Loads and indexes tools.json on first use. */
export const jsonCatalog = (): Promise<Catalog> =>
  (catalog ??= import("@/data/tools.json").then((m) =>
    buildCatalog({
      source: "json",
      categories: m.default.categories as PublicCategory[],
      tools: m.default.tools as SourceTool[],
    }),
  ));

export function createJsonReader() {
  return {
    source: "json" as const,
    summary: async () => summaryOf(await jsonCatalog()),
    browse: async () => browseOf(await jsonCatalog()),
    toolsPage: async (query: ToolsQuery) => toolsPageOf(await jsonCatalog(), query),
    categoryPage: async (slug: string) => categoryPageOf(await jsonCatalog(), slug),
    toolPage: async (slug: string) => {
      const c = await jsonCatalog();
      const tool = c.bySlug.get(slug);
      return tool ? toolPageOf(c, tool, null) : null;
    },
    sitemap: async () => sitemapOf(await jsonCatalog()),
  };
}

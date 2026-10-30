// SERVER ONLY. Picks the public data source for a request:
//   D1 bound and imported -> createD1Reader (small indexed queries; Admin is the source of truth)
//   otherwise             -> createJsonReader (tools.json, loaded lazily; production today)
import { getD1 } from "@/lib/db/env";
import type { D1DatabaseLike } from "@/lib/db/types";
import { createD1Reader } from "./d1-reader";
import { createJsonReader } from "./json-reader";
import type {
  BrowseData,
  CategoryPageData,
  SiteSummary,
  SitemapData,
  ToolPageData,
  ToolsPageData,
  ToolsQuery,
} from "./views";

export type PublicReader = {
  source: "d1" | "json";
  summary(): Promise<SiteSummary>;
  browse(): Promise<BrowseData>;
  toolsPage(query: ToolsQuery): Promise<ToolsPageData>;
  categoryPage(slug: string): Promise<CategoryPageData | null>;
  toolPage(slug: string): Promise<ToolPageData | { redirect: string } | null>;
  sitemap(): Promise<SitemapData>;
};

const json: PublicReader = createJsonReader();
// Once D1 has shown it holds tools, it stays the source for this isolate (one tiny query until then).
let imported: D1DatabaseLike | null = null;

export async function getReader(): Promise<PublicReader> {
  const { db } = await getD1();
  if (!db) return json;
  if (imported !== db) {
    const row = await db.prepare("SELECT 1 AS x FROM tools LIMIT 1").first();
    if (!row) return json; // D1 bound but never imported: keep serving the bundled dataset
    imported = db;
  }
  return createD1Reader(db);
}

/** Test hook. */
export const resetReader = () => {
  imported = null;
};

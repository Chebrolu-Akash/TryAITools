import { tools as jsonTools, type Tool } from "@/lib/tools";
import type { D1DatabaseLike } from "./types";

export type ToolsResult = { source: "d1" | "json"; tools: Tool[] };

/**
 * Published tools. Reads D1 when it is bound and returns rows; on ANY problem (no binding, query
 * error, zero rows) it returns the bundled JSON dataset so the public site never depends on D1
 * being healthy. NOTE: public pages do not call this yet; they switch over only after the D1 import
 * has been verified and approved.
 */
export async function loadTools(db: D1DatabaseLike | null): Promise<ToolsResult> {
  if (db) {
    try {
      const { results } = await db
        .prepare("SELECT t.id AS id, t.name AS name, COALESCE(t.url,'') AS url, c.name AS category, COALESCE(t.subcategory,'') AS subcategory FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.status = 'published' ORDER BY t.sort_order")
        .all<Tool>();
      if (Array.isArray(results) && results.length > 0) return { source: "d1", tools: results };
    } catch (e) {
      console.error("D1 read failed; falling back to JSON", e);
    }
  }
  return { source: "json", tools: jsonTools };
}

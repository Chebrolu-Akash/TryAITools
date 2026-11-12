// Browser client for /api/search: a small JSON endpoint answered by the Worker's gate (src/static/gate.ts) without loading
// the React server, so searches stay cheap even on a freshly started Worker.
import type { ToolsPageData, ToolsQuery } from "./views";

export const SEARCH_PATH = "/api/search";

export const searchUrl = (q: Partial<ToolsQuery>) => {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.category) p.set("category", q.category);
  if (q.pricing && q.pricing !== "all") p.set("pricing", q.pricing);
  if (q.tag) p.set("tag", q.tag);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `${SEARCH_PATH}?${s}` : SEARCH_PATH;
};

export async function searchTools(
  q: Partial<ToolsQuery>,
  signal?: AbortSignal,
): Promise<ToolsPageData> {
  const res = await fetch(searchUrl(q), {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return (await res.json()) as ToolsPageData;
}

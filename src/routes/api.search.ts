import { createFileRoute } from "@tanstack/react-router";
import { getReader } from "@/lib/catalog/reader";
import { normalizeToolsQuery } from "@/lib/catalog/views";

// /api/search for the dev server and for deployments without a static build. When a static build is deployed the gate
// answers this path itself from the build's search index (src/static/search.ts) and this handler never runs.
// Same response shape (ToolsPageData), same visibility rule (the reader only ever returns public tools).
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = Object.fromEntries(new URL(request.url).searchParams);
        const headers = {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        };
        try {
          const page = await (
            await getReader()
          ).toolsPage(normalizeToolsQuery({ ...q, page: Number(q["page"] ?? 1) }));
          return new Response(JSON.stringify(page), { headers });
        } catch (e) {
          console.error("search failed", e instanceof Error ? e.message : e);
          return new Response(JSON.stringify({ error: "Search is temporarily unavailable." }), {
            status: 503,
            headers,
          });
        }
      },
    },
  },
});

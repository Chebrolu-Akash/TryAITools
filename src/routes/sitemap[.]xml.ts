import { createFileRoute } from "@tanstack/react-router";
import { getCatalog } from "@/lib/catalog/source";
import { buildSitemapXml, sitemapEntries } from "@/lib/sitemap";

// Served at /sitemap.xml and generated on request from the live catalogue (D1 when bound, else tools.json), so newly
// published categories and indexable tools are listed within the cache window below.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(buildSitemapXml(sitemapEntries(await getCatalog())), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=300",
          },
        }),
    },
  },
});

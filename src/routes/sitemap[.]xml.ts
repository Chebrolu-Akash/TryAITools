import { createFileRoute } from "@tanstack/react-router";
import { getReader } from "@/lib/catalog/reader";
import { buildSitemapXml, sitemapEntries } from "@/lib/sitemap";

// Served at /sitemap.xml and generated from the public catalogue (D1 when bound, else tools.json): published categories
// and indexable tools only. The D1 result is cached per isolate until the catalogue version changes.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(buildSitemapXml(sitemapEntries(await (await getReader()).sitemap())), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=300",
          },
        }),
    },
  },
});

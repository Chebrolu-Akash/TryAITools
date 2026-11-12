import { createFileRoute } from "@tanstack/react-router";
import { getReader } from "@/lib/catalog/reader";
import { getD1 } from "@/lib/db/env";
import { SITE_URL } from "@/lib/site";
import { buildSitemapXml, sitemapEntries } from "@/lib/sitemap";
import { contentEntries } from "@/static/sitemap";

// Served at /sitemap.xml and generated from the public catalogue (D1 when bound, else tools.json): published categories
// and indexable tools only, plus the published content sections. The D1 result is cached per isolate until the catalogue version changes.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { db } = await getD1();
        const content = db ? await contentEntries(db, SITE_URL) : [];
        const data = await (await getReader()).sitemap();
        return new Response(buildSitemapXml(sitemapEntries(data, content)), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=300",
          },
        });
      },
    },
  },
});

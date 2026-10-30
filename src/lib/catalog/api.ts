// Server functions the public routes call from their loaders. They run on the server (SSR and client navigations alike),
// read only what the page needs (src/lib/catalog/reader.ts), and return only public fields.
import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getReader } from "./reader";
import { normalizeToolsQuery, type ToolsQuery } from "./views";

export type { BrowseCategory, ToolsPageData } from "./views";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugInput = (v: unknown) => {
  if (typeof v !== "string" || v.length > 120 || !SLUG.test(v)) throw notFound();
  return v;
};
const toolsQueryInput = (v: unknown): ToolsQuery =>
  normalizeToolsQuery(v && typeof v === "object" ? (v as Partial<ToolsQuery>) : {});

/** Counts and category links for the layout, hero and about page. */
export const fetchSiteSummary = createServerFn({ method: "GET" }).handler(async () =>
  (await getReader()).summary(),
);

/** Category overview for the home page and /categories, plus the featured logo loop. */
export const fetchBrowse = createServerFn({ method: "GET" }).handler(async () =>
  (await getReader()).browse(),
);

/** One page (48) of /tools, searched and filtered on the server. */
export const fetchToolsPage = createServerFn({ method: "GET" })
  .validator(toolsQueryInput)
  .handler(async ({ data }) => (await getReader()).toolsPage(data));

export const fetchCategory = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data: slug }) => {
    const page = await (await getReader()).categoryPage(slug);
    if (!page) throw notFound();
    return page;
  });

export const fetchToolPage = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data: slug }) => {
    const page = await (await getReader()).toolPage(slug);
    if (!page) throw notFound();
    if ("redirect" in page)
      throw redirect({ to: "/tools/$slug", params: { slug: page.redirect }, statusCode: 301 });
    return page;
  });

// Server functions for the AI News pages. They return only the public fields chosen in reader.ts; an unknown or
// unpublished article, or an unknown category, is a 404.
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getD1 } from "@/lib/db/env";
import { isNewsCategory, pageNumber, searchQuery, type NewsCategory } from "./model";
import { createNewsReader } from "./reader";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reader = async () => createNewsReader((await getD1()).db);

type ListInput = { category: NewsCategory | null; page: number; q: string };
const listInput = (v: unknown): ListInput => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (o["category"] != null && !isNewsCategory(o["category"])) throw notFound();
  return {
    category: (o["category"] as NewsCategory | null | undefined) ?? null,
    page: pageNumber(o["page"]),
    q: searchQuery(o["q"]),
  };
};

/** A listing page: the requested page of news, plus Trending on the first unfiltered page of the landing page. */
export const fetchNewsList = createServerFn({ method: "GET" })
  .validator(listInput)
  .handler(async ({ data }) => {
    const r = await reader();
    const landing = !data.category && !data.q && data.page === 1;
    const [list, trending] = await Promise.all([
      r.list(data),
      landing ? r.trending(new Date()) : Promise.resolve([]),
    ]);
    return { ...list, trending, q: data.q };
  });

export const fetchNewsItem = createServerFn({ method: "GET" })
  .validator((v: unknown) => {
    if (typeof v !== "string" || v.length > 120 || !SLUG.test(v)) throw notFound();
    return v;
  })
  .handler(async ({ data: slug }) => {
    const r = await reader();
    const item = await r.item(slug);
    if (!item) throw notFound();
    return { item, related: await r.related(slug, item.category) };
  });

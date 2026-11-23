// Server functions for the AI News pages. They return only the public fields chosen in reader.ts; an unknown or
// unpublished article, or an unknown category, is a 404.
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getD1 } from "@/lib/db/env";
import {
  NEWS_PAGE_SIZE,
  isNewsCategory,
  pageNumber,
  searchQuery,
  type NewsCategory,
} from "./model";
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

/**
 * A listing page: the requested page of news plus the sidebar: Trending (all news, last 7 days), the newest articles
 * across every category ("Latest updates") and the number of published articles per category.
 */
export const fetchNewsList = createServerFn({ method: "GET" })
  .validator(listInput)
  .handler(async ({ data }) => {
    const r = await reader();
    const [list, trending, latest, counts] = await Promise.all([
      r.list(data),
      r.trending(new Date()),
      r.latest(NEWS_PAGE_SIZE + 6),
      r.categoryCounts(),
    ]);
    return { ...list, trending, latest, counts, q: data.q };
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

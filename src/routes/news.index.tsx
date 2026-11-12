import { createFileRoute } from "@tanstack/react-router";
import { NewsListing } from "@/components/site/NewsViews";
import { fetchNewsList } from "@/lib/news/api";
import { validateNewsSearch } from "@/lib/news/model";
import { newsListHead } from "@/lib/news/seo";

export const Route = createFileRoute("/news/")({
  validateSearch: validateNewsSearch,
  loaderDeps: ({ search }) => ({ q: search.q ?? "", page: search.page ?? 1 }),
  loader: ({ deps }) => fetchNewsList({ data: { category: null, q: deps.q, page: deps.page } }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    newsListHead({
      category: null,
      q: loaderData?.q ?? "",
      page: loaderData?.page ?? 1,
      count: loaderData?.items.length ?? 0,
    }),
  component: NewsPage,
});

function NewsPage() {
  const d = Route.useLoaderData();
  return (
    <NewsListing
      category={null}
      items={d.items}
      trending={d.trending}
      page={d.page}
      hasMore={d.hasMore}
      q={d.q}
    />
  );
}

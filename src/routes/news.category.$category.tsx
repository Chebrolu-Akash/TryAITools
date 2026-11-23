import { createFileRoute, notFound } from "@tanstack/react-router";
import { NewsListing, NewsNotFound } from "@/components/site/NewsViews";
import { fetchNewsList } from "@/lib/news/api";
import { isNewsCategory, validateNewsSearch } from "@/lib/news/model";
import { newsListHead } from "@/lib/news/seo";
import { notFoundHead } from "@/lib/content/seo";

export const Route = createFileRoute("/news/category/$category")({
  validateSearch: validateNewsSearch,
  loaderDeps: ({ search }) => ({ q: search.q ?? "", page: search.page ?? 1 }),
  loader: ({ params, deps }) => {
    if (!isNewsCategory(params.category)) throw notFound();
    return fetchNewsList({ data: { category: params.category, q: deps.q, page: deps.page } });
  },
  staleTime: Infinity,
  head: ({ loaderData, params }) =>
    loaderData && isNewsCategory(params.category)
      ? newsListHead({
          category: params.category,
          q: loaderData.q,
          page: loaderData.page,
          count: loaderData.items.length,
        })
      : notFoundHead(`/news/category/${params.category}`, "Category"),
  notFoundComponent: () => <NewsNotFound />,
  component: NewsCategoryPage,
});

function NewsCategoryPage() {
  const d = Route.useLoaderData();
  const { category } = Route.useParams();
  if (!isNewsCategory(category)) return <NewsNotFound />;
  return (
    <NewsListing
      category={category}
      items={d.items}
      trending={d.trending}
      latest={d.latest}
      counts={d.counts}
      page={d.page}
      hasMore={d.hasMore}
      q={d.q}
    />
  );
}

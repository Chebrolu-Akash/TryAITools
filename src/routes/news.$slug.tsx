import { createFileRoute } from "@tanstack/react-router";
import { NewsArticleView, NewsNotFound } from "@/components/site/NewsViews";
import { notFoundHead } from "@/lib/content/seo";
import { fetchNewsItem } from "@/lib/news/api";
import { newsArticleHead } from "@/lib/news/seo";

export const Route = createFileRoute("/news/$slug")({
  loader: ({ params }) => fetchNewsItem({ data: params.slug }),
  staleTime: Infinity,
  head: ({ loaderData, params }) =>
    loaderData?.item
      ? newsArticleHead(loaderData.item)
      : notFoundHead(`/news/${params.slug}`, "Article"),
  notFoundComponent: () => <NewsNotFound />,
  component: NewsArticlePage,
});

function NewsArticlePage() {
  const { item, related } = Route.useLoaderData();
  return <NewsArticleView a={item} related={related} />;
}

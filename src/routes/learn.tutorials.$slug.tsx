import { createFileRoute } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/site/ContentViews";
import { TutorialPage, tutorialHead } from "@/components/site/LearnPages";
import { fetchContentItem } from "@/lib/content/api";
import type { TutorialCard, TutorialDetail } from "@/lib/content/model";

export const Route = createFileRoute("/learn/tutorials/$slug")({
  // Drafts, archived and unknown tutorials 404 (the server only returns published rows).
  loader: async ({ params }) => {
    const r = await fetchContentItem({ data: { section: "tutorials", slug: params.slug } });
    return { item: r.item as TutorialDetail, related: r.related as TutorialCard[] };
  },
  staleTime: Infinity,
  head: ({ loaderData, params }) => tutorialHead(params.slug, loaderData?.item),
  notFoundComponent: () => (
    <ContentNotFound what="Tutorial" href="/learn/tutorials" back="Browse AI tutorials" />
  ),
  component: TutorialDetailPage,
});

function TutorialDetailPage() {
  const { item, related } = Route.useLoaderData();
  return <TutorialPage t={item} related={related} />;
}

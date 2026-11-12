import { createFileRoute } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/site/ContentViews";
import { CourseOrBookPage, courseHead, ensureKind } from "@/components/site/LearnPages";
import { fetchContentItem } from "@/lib/content/api";
import type { CourseCard, CourseDetail } from "@/lib/content/model";

export const Route = createFileRoute("/learn/books/$slug")({
  // Drafts, archived and unknown entries 404; a course opened under this path redirects to its own URL.
  loader: async ({ params }) => {
    const r = await fetchContentItem({ data: { section: "courses", slug: params.slug } });
    ensureKind(r.item as CourseDetail, "book");
    return { item: r.item as CourseDetail, related: r.related as CourseCard[] };
  },
  staleTime: Infinity,
  head: ({ loaderData, params }) => courseHead("book", params.slug, loaderData?.item),
  notFoundComponent: () => (
    <ContentNotFound what="Book" href="/learn/books" back="Browse AI books" />
  ),
  component: BookPage,
});

function BookPage() {
  const { item, related } = Route.useLoaderData();
  return <CourseOrBookPage kind="book" c={item} related={related} />;
}

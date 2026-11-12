import { createFileRoute } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/site/ContentViews";
import { CourseOrBookPage, courseHead, ensureKind } from "@/components/site/LearnPages";
import { fetchContentItem } from "@/lib/content/api";
import type { CourseCard, CourseDetail } from "@/lib/content/model";

export const Route = createFileRoute("/learn/courses/$slug")({
  // Drafts, archived and unknown entries 404; a book opened under this path redirects to its own URL.
  loader: async ({ params }) => {
    const r = await fetchContentItem({ data: { section: "courses", slug: params.slug } });
    ensureKind(r.item as CourseDetail, "course");
    return { item: r.item as CourseDetail, related: r.related as CourseCard[] };
  },
  staleTime: Infinity,
  head: ({ loaderData, params }) => courseHead("course", params.slug, loaderData?.item),
  notFoundComponent: () => (
    <ContentNotFound what="Course" href="/learn/courses" back="Browse AI courses" />
  ),
  component: CoursePage,
});

function CoursePage() {
  const { item, related } = Route.useLoaderData();
  return <CourseOrBookPage kind="course" c={item} related={related} />;
}

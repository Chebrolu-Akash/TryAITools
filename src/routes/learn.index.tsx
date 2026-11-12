import { createFileRoute } from "@tanstack/react-router";
import { LearnHub } from "@/components/site/ContentViews";
import { listingHead } from "@/components/site/LearnPages";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { CourseCard, TutorialCard } from "@/lib/content/model";

// /learn: the AI Learning Hub. Indexable once any course, book or tutorial is published.
export const Route = createFileRoute("/learn/")({
  loader: async () => {
    const [c, t] = await Promise.all([
      fetchContentList({ data: "courses" }),
      fetchContentList({ data: "tutorials" }),
    ]);
    return { resources: c.items as CourseCard[], tutorials: t.items as TutorialCard[] };
  },
  staleTime: Infinity, // pre-built HTML: never refetch in the browser
  head: ({ loaderData }) =>
    listingHead(
      "/learn",
      "AI Learning Hub: Courses, Books & Tutorials",
      "Learn AI with hand-picked courses, books and practical tutorials for every level, all in one place.",
      (loaderData?.resources.length ?? 0) + (loaderData?.tutorials.length ?? 0),
    ),
  component: LearnHubPage,
});

function LearnHubPage() {
  const { resources, tutorials } = Route.useLoaderData();
  const courses = resources.filter((r) => r.kind === "course");
  const books = resources.filter((r) => r.kind === "book");
  return (
    <SectionLanding
      title="AI Learning Hub"
      intro="Learn AI the practical way. Pick a structured course, read a book that explains the ideas, or follow a short tutorial to get one job done, at any level."
      empty={{ heading: "", text: "" }}
    >
      <LearnHub courses={courses} books={books} tutorials={tutorials} />
    </SectionLanding>
  );
}

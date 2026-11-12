import { createFileRoute } from "@tanstack/react-router";
import { CoursesList } from "@/components/site/ContentViews";
import { HUB, listingHead, SiblingLinks } from "@/components/site/LearnPages";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { CourseCard } from "@/lib/content/model";

export const Route = createFileRoute("/learn/courses/")({
  loader: async () => ({
    items: ((await fetchContentList({ data: "courses" })).items as CourseCard[]).filter(
      (c) => c.kind === "course",
    ),
  }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    listingHead(
      "/learn/courses",
      "AI Courses for Every Level",
      "Hand-picked AI courses, from first prompts to machine learning and building agents, with level, format, duration and price.",
      loaderData?.items.length ?? 0,
    ),
  component: CoursesPage,
});

function CoursesPage() {
  const { items } = Route.useLoaderData();
  return (
    <SectionLanding
      title="AI Courses"
      parents={[HUB]}
      intro={
        <>
          Structured AI courses picked for their practical value. Filter by level, price or topic,
          and open a course for our notes before you sign up.
          <SiblingLinks current="course" />
        </>
      }
      empty={{
        heading: "Our first course picks are on the way",
        text: "We are reviewing courses now. In the meantime, explore AI tools in the directory.",
      }}
    >
      {items.length > 0 ? <CoursesList items={items} /> : undefined}
    </SectionLanding>
  );
}

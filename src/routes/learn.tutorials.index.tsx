import { createFileRoute } from "@tanstack/react-router";
import { TutorialsList } from "@/components/site/ContentViews";
import { HUB, listingHead, SiblingLinks } from "@/components/site/LearnPages";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { TutorialCard } from "@/lib/content/model";

export const Route = createFileRoute("/learn/tutorials/")({
  loader: async () => ({
    items: (await fetchContentList({ data: "tutorials" })).items as TutorialCard[],
  }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    listingHead(
      "/learn/tutorials",
      "AI Tutorials: Practical Step-by-Step Guides",
      "Short, practical AI tutorials that walk you through one task at a time, by difficulty and topic.",
      loaderData?.items.length ?? 0,
    ),
  component: TutorialsPage,
});

function TutorialsPage() {
  const { items } = Route.useLoaderData();
  return (
    <SectionLanding
      title="AI Tutorials"
      parents={[HUB]}
      intro={
        <>
          Practical walkthroughs for getting one specific job done with AI. Filter by difficulty or
          topic.
          <SiblingLinks current="tutorial" />
        </>
      }
      empty={{
        heading: "Our first tutorials are being written",
        text: "Check back soon. In the meantime, explore AI tools in the directory.",
      }}
    >
      {items.length > 0 ? <TutorialsList items={items} /> : undefined}
    </SectionLanding>
  );
}

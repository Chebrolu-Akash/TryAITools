import { createFileRoute } from "@tanstack/react-router";
import { GadgetsList } from "@/components/site/ContentViews";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { GadgetCard } from "@/lib/content/model";
import { pageHead } from "@/lib/seo";

// noindex while the section has no published entries (an empty listing should not be indexed).
export const Route = createFileRoute("/gadgets/")({
  loader: () => fetchContentList({ data: "gadgets" }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    pageHead({
      title: "AI Gadgets | TryAITools",
      description:
        "Devices with AI built in: smart speakers, wearables, cameras, translators and home robots.",
      path: "/gadgets",
      noindex: !loaderData?.items.length,
    }),
  component: GadgetsPage,
});

function GadgetsPage() {
  const items = Route.useLoaderData().items as GadgetCard[];
  return (
    <SectionLanding
      title="AI Gadgets"
      intro="Devices with AI built in: smart speakers, wearables, cameras, translators and home robots, chosen for what the AI actually does."
      empty={{
        heading: "Gadget picks are coming soon",
        text: "We are testing devices now. Until then, explore 2,000+ AI tools in the directory.",
      }}
    >
      {items.length > 0 ? <GadgetsList items={items} /> : undefined}
    </SectionLanding>
  );
}

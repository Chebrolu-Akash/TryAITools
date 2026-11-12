import { createFileRoute } from "@tanstack/react-router";
import { GuestList, SponsoredBadge } from "@/components/site/ContentViews";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { GuestCard } from "@/lib/content/model";
import { pageHead } from "@/lib/seo";

// noindex while the section has no published entries (an empty listing should not be indexed).
export const Route = createFileRoute("/guest-articles/")({
  loader: () => fetchContentList({ data: "guest-articles" }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    pageHead({
      title: "Guest Articles | TryAITools",
      description:
        "Sponsored articles about AI from companies and contributors, each clearly labelled as sponsored.",
      path: "/guest-articles",
      noindex: !loaderData?.items.length,
    }),
  component: GuestArticlesPage,
});

function GuestArticlesPage() {
  const items = Route.useLoaderData().items as GuestCard[];
  return (
    <SectionLanding
      title="Guest Articles"
      intro={
        <>
          Articles about AI written by companies and contributors. Every guest article is paid for
          by its author and marked <SponsoredBadge />. Our own writing is on the{" "}
          <a href="/blog" className="font-semibold text-primary">
            Blog
          </a>
          .
        </>
      }
      aside={
        <aside className="w-full max-w-sm rounded-3xl border border-border bg-background p-6 shadow-soft">
          <h2 className="text-xl font-bold">Publish your article</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Reach readers looking for AI tools. Every article is reviewed by our editors before it
            goes live. Submissions open soon.
          </p>
        </aside>
      }
      empty={{
        heading: "No guest articles yet",
        text: "The first sponsored articles will appear here, clearly labelled.",
      }}
    >
      {items.length > 0 ? <GuestList items={items} /> : undefined}
    </SectionLanding>
  );
}

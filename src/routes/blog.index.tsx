import { createFileRoute } from "@tanstack/react-router";
import { BlogList } from "@/components/site/ContentViews";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { PostCard } from "@/lib/content/model";
import { pageHead } from "@/lib/seo";

// noindex until the first post is published (an empty listing should not be indexed).
export const Route = createFileRoute("/blog/")({
  loader: () => fetchContentList({ data: "blog" }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    pageHead({
      title: "Blog | TryAITools",
      description: "Guides, comparisons and news about AI tools from the TryAITools team.",
      path: "/blog",
      noindex: !loaderData?.items.length,
    }),
  component: BlogPage,
});

function BlogPage() {
  const items = Route.useLoaderData().items as PostCard[];
  return (
    <SectionLanding
      title="Blog"
      intro="Guides, comparisons and news from the TryAITools team."
      empty={{
        heading: "No posts yet",
        text: "Our first guides and comparisons are being written.",
      }}
    >
      {items.length > 0 ? <BlogList items={items} /> : undefined}
    </SectionLanding>
  );
}

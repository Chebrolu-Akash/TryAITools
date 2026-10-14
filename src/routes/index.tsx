import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { Hero } from "@/components/site/Hero";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TryAITools — Discover 2,000+ AI Tools by Category" },
      { name: "description", content: "Browse over 2,000 hand-picked AI tools for writing, images, video, coding, marketing and more." },
      { property: "og:title", content: "TryAITools — Discover 2,000+ AI Tools" },
      { property: "og:description", content: "Find the right AI tool for every task, organized into 15 categories." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <Page>
      <Hero />
      <CategoryBrowser heading="h2" />
    </Page>
  ),
});


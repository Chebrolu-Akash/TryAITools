import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";

export const Route = createFileRoute("/categories/")({
  head: () => ({
    meta: [
      { title: "AI Tool Categories | TryAITools" },
      { name: "description", content: "Explore 15 AI tool categories and their subcategories." },
      { property: "og:title", content: "AI Tool Categories | TryAITools" },
      { property: "og:description", content: "Explore 15 AI tool categories and their subcategories." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <Page><CategoryBrowser /></Page>,
});

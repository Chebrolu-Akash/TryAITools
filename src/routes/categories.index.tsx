import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/categories/")({
  head: () =>
    pageHead({ title: "AI Tool Categories | TryAITools", description: "Explore 15 AI tool categories and their subcategories.", path: "/categories" }),
  component: () => <Page><CategoryBrowser /></Page>,
});

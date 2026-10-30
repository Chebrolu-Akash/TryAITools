import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { fetchBrowse } from "@/lib/catalog/api";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/categories/")({
  loader: () => fetchBrowse(),
  head: () =>
    pageHead({
      title: "AI Tool Categories | TryAITools",
      description: "Explore 15 AI tool categories and their subcategories.",
      path: "/categories",
    }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const { toolCount, categories } = Route.useLoaderData();
  return (
    <Page>
      <CategoryBrowser toolCount={toolCount} categories={categories} />
    </Page>
  );
}

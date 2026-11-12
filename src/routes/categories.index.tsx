import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { fetchBrowse } from "@/lib/catalog/api";
import { pageHead } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

export const Route = createFileRoute("/categories/")({
  loader: () => fetchBrowse(),
  staleTime: Infinity, // pre-built HTML: never refetch in the browser
  head: ({ loaderData }) => ({
    ...pageHead({
      title: "AI Tool Categories | TryAITools",
      description: `Explore ${loaderData?.categories.length ?? 15} AI tool categories and their subcategories, from writing, image and video tools to coding, marketing, SEO and education.`,
      path: "/categories",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
            {
              "@type": "ListItem",
              position: 2,
              name: "Categories",
              item: absoluteUrl("/categories"),
            },
          ],
        }),
      },
    ],
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

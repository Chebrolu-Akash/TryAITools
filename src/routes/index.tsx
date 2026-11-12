import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { Hero } from "@/components/site/Hero";
import { fetchBrowse } from "@/lib/catalog/api";
import { pageHead } from "@/lib/seo";
import { countLabel, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE_URL}/tools?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    { "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/logo-512.png` },
  ],
};

export const Route = createFileRoute("/")({
  loader: () => fetchBrowse(),
  staleTime: Infinity, // pre-built HTML: never refetch in the browser
  head: ({ loaderData }) => ({
    ...pageHead({
      title: loaderData
        ? `TryAITools — Discover ${countLabel(loaderData.toolCount)} AI Tools by Category`
        : "TryAITools — Discover AI Tools by Category",
      description: SITE_DESCRIPTION,
      path: "/",
    }),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(websiteJsonLd) }],
  }),
  component: HomePage,
});

function HomePage() {
  const { toolCount, categories, featured } = Route.useLoaderData();
  return (
    <Page flush>
      <Hero featured={featured} />
      <CategoryBrowser heading="h2" toolCount={toolCount} categories={categories} />
    </Page>
  );
}

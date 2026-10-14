import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { Hero } from "@/components/site/Hero";
import { pageHead } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: SITE_NAME, url: SITE_URL, potentialAction: { "@type": "SearchAction", target: `${SITE_URL}/tools?q={search_term_string}`, "query-input": "required name=search_term_string" } },
    { "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/logo-512.png` },
  ],
};

export const Route = createFileRoute("/")({
  head: () => ({
    ...pageHead({
      title: "TryAITools — Discover 2,000+ AI Tools by Category",
      description: SITE_DESCRIPTION,
      path: "/",
    }),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(websiteJsonLd) }],
  }),
  component: () => (
    <Page>
      <Hero />
      <CategoryBrowser heading="h2" />
    </Page>
  ),
});


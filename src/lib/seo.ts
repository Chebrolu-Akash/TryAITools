import { OG_IMAGE, SITE_NAME, absoluteUrl } from "@/lib/site";

type PageSeo = { title: string; description: string; path: string; noindex?: boolean };

/** Shared <head> tags (title, description, canonical, Open Graph, Twitter) for a route. */
export const pageHead = ({ title, description, path, noindex }: PageSeo) => ({
  meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: absoluteUrl(path) },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:image", content: OG_IMAGE },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${SITE_NAME} logo` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: OG_IMAGE },
    ...(noindex ? [{ name: "robots", content: "noindex, follow" }] : []),
  ],
  links: [{ rel: "canonical", href: absoluteUrl(path) }],
});

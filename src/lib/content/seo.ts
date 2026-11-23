// <head> for content detail pages: title, description, canonical (or the entry's own canonical URL), social image,
// noindex, and JSON-LD. Structured data describes only what the entry states: no ratings, no invented prices.
import { pageHead } from "@/lib/seo";
import { SITE_NAME, absoluteUrl, titleWithSite } from "@/lib/site";
import type { PublicImage } from "./model";

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export const notFoundHead = (path: string, what: string) =>
  pageHead({
    title: `${what} not found | ${SITE_NAME}`,
    description: `This ${what.toLowerCase()} doesn't exist or is no longer available.`,
    path,
    noindex: true,
    canonical: false,
  });

export function detailHead({
  path,
  section,
  parents = [],
  title,
  seoTitle,
  description,
  indexable,
  canonical,
  image,
  article,
  extra = [],
}: {
  path: string;
  section: { label: string; path: string };
  /** breadcrumb levels between the site and `section` */
  parents?: { label: string; path: string }[];
  title: string;
  seoTitle: string | null;
  description: string;
  indexable: boolean;
  canonical: string | null;
  image: PublicImage | null;
  /** an Article / BlogPosting graph node is added when given */
  article?: {
    type: "Article" | "BlogPosting";
    author: string | null;
    published: string;
    modified: string;
  };
  extra?: unknown[];
}) {
  const self = absoluteUrl(path);
  // an image is a site path (uploaded media) or, for AI News, a verified https URL of the publisher's own image
  const imageUrl = image
    ? /^https:\/\//.test(image.url)
      ? image.url
      : absoluteUrl(image.url)
    : null;
  const otherCanonical = canonical && canonical !== self ? canonical : null;
  const base = pageHead({
    title: titleWithSite(seoTitle ?? title),
    description: clip(description, 158),
    path,
    noindex: !indexable,
    canonicalUrl: otherCanonical,
    image: image && { path: image.url, alt: image.alt, width: image.width, height: image.height },
    type: article ? "article" : "website",
  });
  const graph: unknown[] = [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { name: SITE_NAME, path: "/" },
        ...parents.map((p) => ({ name: p.label, path: p.path })),
        { name: section.label, path: section.path },
      ]
        .map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: absoluteUrl(c.path),
        }))
        .concat({ "@type": "ListItem", position: parents.length + 3, name: title, item: self }),
    },
    ...extra,
  ];
  if (article)
    graph.unshift({
      "@type": article.type,
      headline: clip(title, 110),
      description: clip(description, 300),
      datePublished: article.published,
      dateModified: article.modified,
      mainEntityOfPage: otherCanonical ?? self,
      ...(imageUrl ? { image: imageUrl } : {}),
      author: article.author
        ? { "@type": "Person", name: article.author }
        : { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
      publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    });
  return {
    ...base,
    scripts: [
      {
        type: "application/ld+json",
        children: jsonLd({ "@context": "https://schema.org", "@graph": graph }),
      },
    ],
  };
}

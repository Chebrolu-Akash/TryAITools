import { OG_IMAGE, SITE_NAME, absoluteUrl } from "@/lib/site";

type PageSeo = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  /** false for "not found" pages: a page that does not exist claims no canonical URL (and no og:url). */
  canonical?: boolean;
  /** An absolute URL this page is a copy of (a republished guest article or post); defaults to the page itself. */
  canonicalUrl?: string | null | undefined;
  /** A site path (e.g. /media/<id>.webp) for the social preview image; defaults to the site's OG image. */
  image?:
    { path: string; alt: string; width?: number | null; height?: number | null } | null | undefined;
  type?: "website" | "article";
};

/** Shared <head> tags (title, description, canonical, Open Graph, Twitter) for a route. */
export const pageHead = ({
  title,
  description,
  path,
  noindex,
  canonical = true,
  canonicalUrl,
  image,
  type = "website",
}: PageSeo) => {
  const href = canonicalUrl || absoluteUrl(path);
  const img = image
    ? /^https:\/\//.test(image.path)
      ? image.path
      : absoluteUrl(image.path)
    : OG_IMAGE;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...(canonical ? [{ property: "og:url", content: href }] : []),
      { property: "og:type", content: type },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: img },
      ...(image
        ? image.width && image.height
          ? [
              { property: "og:image:width", content: String(image.width) },
              { property: "og:image:height", content: String(image.height) },
            ]
          : []
        : [
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
          ]),
      { property: "og:image:alt", content: image ? image.alt || title : `${SITE_NAME} logo` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: img },
      ...(noindex ? [{ name: "robots", content: "noindex, follow" }] : []),
    ],
    links: canonical ? [{ rel: "canonical", href }] : [],
  };
};

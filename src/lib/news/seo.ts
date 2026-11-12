// <head> for the AI News pages. Listings are indexable once they have articles; search results and empty listings are
// noindex. Article pages carry Article JSON-LD (publisher TryAITools, the summary being ours) and are canonical to
// themselves: the page is an original summary that links to the publisher, not a copy of it.
import { detailHead } from "@/lib/content/seo";
import { pageHead } from "@/lib/seo";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import {
  NEWS_PATH,
  categoryLabel,
  newsArticlePath,
  newsCategoryPath,
  type NewsCategory,
  type NewsDetail,
} from "./model";

export function newsListHead(opts: {
  category: NewsCategory | null;
  q: string;
  page: number;
  count: number;
}) {
  const base = opts.category ? newsCategoryPath(opts.category) : NEWS_PATH;
  const label = opts.category ? `${categoryLabel(opts.category)} — AI News` : "AI News";
  const suffix = opts.page > 1 ? ` (page ${opts.page})` : "";
  const noindex = !!opts.q || opts.count === 0;
  const head = pageHead({
    title: `${label}${suffix} | ${SITE_NAME}`,
    description: opts.category
      ? `The latest AI ${categoryLabel(opts.category).toLowerCase()} news from official company blogs and trusted outlets, summarised by TryAITools.`
      : "The latest AI news: model releases, tool launches, research, funding and policy from official AI company blogs and trusted outlets, summarised every few hours.",
    path: opts.page > 1 ? `${base}?page=${opts.page}` : base,
    noindex,
  });
  if (noindex) return head;
  // Home > AI News (> category): the same trail the article pages carry
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "AI News", path: NEWS_PATH },
    ...(opts.category ? [{ name: categoryLabel(opts.category), path: base }] : []),
  ];
  return {
    ...head,
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.name,
            item: absoluteUrl(c.path),
          })),
        }).replace(/</g, "\\u003c"),
      },
    ],
  };
}

export function newsArticleHead(a: NewsDetail) {
  return detailHead({
    path: newsArticlePath(a.slug),
    section: { label: "AI News", path: NEWS_PATH },
    title: a.title,
    seoTitle: null,
    description: a.description || a.summary,
    indexable: true,
    canonical: null,
    // only images the reader verified against the official-source allowlist (isAllowedNewsImage)
    image: a.imageUrl ? { url: a.imageUrl, alt: a.title, width: null, height: null } : null,
    article: { type: "Article", author: null, published: a.publishedAt, modified: a.updatedAt },
  });
}

import type { SitemapData } from "@/lib/catalog/views";
import { absoluteUrl } from "@/lib/site";
import { FIXED_PAGES } from "@/static/sitemap";

export type SitemapEntry = {
  path: string;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

// Fixed pages come from the list the static build uses, so the live and pre-built sitemaps cannot drift apart.
// Category and tool pages come from the live catalogue.
/** `content`: the content-section entries (src/static/sitemap.ts contentEntries), listed after the fixed pages. */
export const sitemapEntries = (data: SitemapData, content: SitemapEntry[] = []): SitemapEntry[] => [
  ...FIXED_PAGES.map(({ path, changefreq, priority }) => ({ path, changefreq, priority })),
  ...content.map(({ path, changefreq, priority }) => ({ path, changefreq, priority })),
  ...data.categorySlugs.map((slug): SitemapEntry => ({
    path: `/categories/${slug}`,
    changefreq: "weekly",
    priority: 0.8,
  })),
  ...data.toolSlugs.map((slug): SitemapEntry => ({
    path: `/tools/${slug}`,
    changefreq: "monthly",
    priority: 0.6,
  })),
];

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const buildSitemapXml = (entries: SitemapEntry[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries
    .map(
      (e) =>
        `  <url>\n    <loc>${escapeXml(absoluteUrl(e.path))}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;

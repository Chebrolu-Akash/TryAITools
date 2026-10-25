import { categories } from "@/lib/tools";
import { absoluteUrl } from "@/lib/site";

export type SitemapEntry = { path: string; changefreq: "daily" | "weekly" | "monthly" | "yearly"; priority: number };

// Pages with fixed paths. Category pages are added from the data file so new categories appear automatically.
const STATIC_PAGES: SitemapEntry[] = [
  { path: "/", changefreq: "daily", priority: 1.0 },
  { path: "/tools", changefreq: "daily", priority: 0.9 },
  { path: "/categories", changefreq: "weekly", priority: 0.8 },
  { path: "/about", changefreq: "monthly", priority: 0.5 },
  { path: "/privacy", changefreq: "yearly", priority: 0.3 },
  { path: "/terms", changefreq: "yearly", priority: 0.3 },
  { path: "/affiliate-disclosure", changefreq: "yearly", priority: 0.3 },
];

export const sitemapEntries = (): SitemapEntry[] => [
  ...STATIC_PAGES,
  ...categories.map((c): SitemapEntry => ({ path: `/categories/${c.slug}`, changefreq: "weekly", priority: 0.8 })),
];

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export const buildSitemapXml = (entries: SitemapEntry[] = sitemapEntries()): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries
    .map(
      (e) =>
        `  <url>\n    <loc>${escapeXml(absoluteUrl(e.path))}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;

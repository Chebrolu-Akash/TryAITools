// Shared shapes and small pure helpers of the AI News section (no runtime dependencies: imported by the public pages,
// the admin, the ingestion pipeline and the static-site gate).

export const NEWS_CATEGORIES = [
  { slug: "model-releases", label: "Model Releases" },
  { slug: "tool-launches", label: "Tool Launches" },
  { slug: "company-news", label: "Company News" },
  { slug: "research", label: "Research" },
  { slug: "business-funding", label: "Business & Funding" },
  { slug: "regulation-policy", label: "Regulation & Policy" },
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number]["slug"];
const CATEGORY_SLUGS = new Set<string>(NEWS_CATEGORIES.map((c) => c.slug));
export const isNewsCategory = (v: unknown): v is NewsCategory =>
  typeof v === "string" && CATEGORY_SLUGS.has(v);
export const categoryLabel = (slug: string) =>
  NEWS_CATEGORIES.find((c) => c.slug === slug)?.label ?? "AI News";

/**
 * Where article images may come from: the media hosts the official sources use in their own feeds (checked 2026-11-02),
 * with a path prefix where a host is shared (storage.googleapis.com). One list for three jobs: ingestion keeps only
 * these image URLs, the reader re-checks them (also for articles stored earlier), and the Content-Security-Policy
 * (src/lib/security-headers.ts, public/_headers) allows exactly these in img-src. Any other image falls back to the
 * branded placeholder. A new source with another image host needs an entry here.
 */
export const NEWS_IMAGE_SOURCES = [
  "https://blogs.nvidia.com/wp-content/uploads/",
  "https://www.microsoft.com/en-us/research/",
  "https://engineering.fb.com/wp-content/uploads/",
  "https://storage.googleapis.com/gweb-uniblog-publish-prod/",
  "https://storage.googleapis.com/gweb-research2023-media/",
  "https://lh3.googleusercontent.com/",
] as const;

/** True for an https image URL under one of NEWS_IMAGE_SOURCES (no credentials, no odd ports). */
export function isAllowedNewsImage(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const href = u.origin + u.pathname;
  return NEWS_IMAGE_SOURCES.some((p) => href.startsWith(p));
}

/**
 * How long ago `iso` was, for news within the last week: "Just now", "5 minutes ago", "3 hours ago", "Yesterday",
 * "4 days ago". Null for anything older, unparseable, or in the future (a feed clock ahead of ours is never shown as
 * "ago"); the card then shows only the calendar date.
 */
export function relativeAge(iso: string, now: number): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.floor((now - t) / 60_000);
  if (min < -5) return null;
  if (min < 1) return "Just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  return d < 7 ? `${d} days ago` : null;
}

export const NEWS_PATH = "/news";
export const NEWS_PAGE_SIZE = 12;
export const newsArticlePath = (slug: string) => `${NEWS_PATH}/${slug}`;
export const newsCategoryPath = (slug: string) => `${NEWS_PATH}/category/${slug}`;

/** A news card: what listings show. Every field is public. */
export type NewsCard = {
  slug: string;
  title: string;
  description: string;
  category: NewsCategory;
  sourceName: string;
  imageUrl: string | null;
  publishedAt: string;
  sourcePublishedAt: string | null;
  featured: boolean;
  /** Minutes to read the AI summary; null/absent when unknown. */
  readMinutes?: number | null;
};
/** An article page: the card plus the AI summary, takeaways and attribution. */
export type NewsDetail = NewsCard & {
  summary: string;
  takeaways: string[];
  tags: string[];
  companies: string[];
  products: string[];
  canonicalUrl: string;
  sourceSiteUrl: string | null;
  collectedAt: string;
  updatedAt: string;
};
export type NewsListPage = {
  items: NewsCard[];
  page: number;
  hasMore: boolean;
};

/** Lower-case ASCII slug, words joined by "-", at most `max` characters, never ending in "-". */
export function slugify(s: string, max = 70): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/g, "");
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** A JSON array of strings stored in a TEXT column, or [] for anything else. */
export function stringList(v: unknown): string[] {
  try {
    const x: unknown = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}

/** Clamps a page query value to 1..500. */
export const pageNumber = (v: unknown) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : 1;
};
/** A search query as the pages and the reader accept it: trimmed, at most 80 characters. */
export const searchQuery = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

export type NewsSearch = { q?: string; page?: number };
/** validateSearch of the listing routes: defaults are dropped so /news stays one URL. */
export const validateNewsSearch = (s: Record<string, unknown>): NewsSearch => {
  const q = searchQuery(s["q"]);
  const page = pageNumber(s["page"]);
  return { ...(q ? { q } : {}), ...(page > 1 ? { page } : {}) };
};

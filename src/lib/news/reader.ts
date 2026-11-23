// SERVER ONLY. Public reads of the AI News section with explicit column lists: source_text, last_error, token counts and
// other internal fields are never selected. Only status = 'published' rows are visible. A database without the news
// tables (migration 0009 not applied) reads as "no news", not as an error.
import type { D1DatabaseLike } from "@/lib/db/types";
import { missingSchema } from "@/lib/content/reader";
import {
  NEWS_PAGE_SIZE,
  isAllowedNewsImage,
  stringList,
  type NewsCard,
  type NewsCategory,
  type NewsDetail,
  type NewsListPage,
} from "./model";

type Row = Record<string, unknown>;
// summary_chars: the length of the AI summary, for the card's reading time (listings never receive the summary itself).
const CARD = `a.slug, a.title, a.card_description, a.category, a.source_name, a.image_url, a.published_at,
  a.source_published_at, a.featured, LENGTH(a.summary) AS summary_chars`;
const DETAIL = `${CARD}, a.summary, a.takeaways, a.tags, a.companies, a.products, a.canonical_url, a.collected_at,
  a.updated_at, s.site_url`;

/** Minutes to read a summary of `chars` characters (about 6 characters a word, 220 words a minute); null when empty. */
export const readMinutes = (chars: number): number | null =>
  Number.isFinite(chars) && chars > 0 ? Math.max(1, Math.round(chars / 6 / 220)) : null;

const card = (r: Row): NewsCard => ({
  slug: String(r["slug"]),
  title: String(r["title"]),
  description: String(r["card_description"] ?? ""),
  category: String(r["category"]) as NewsCategory,
  sourceName: String(r["source_name"]),
  // Re-checked on every read, so rows stored before the allowlist existed are covered too.
  imageUrl: isAllowedNewsImage(r["image_url"]) ? r["image_url"] : null,
  publishedAt: String(r["published_at"] ?? ""),
  sourcePublishedAt: typeof r["source_published_at"] === "string" ? r["source_published_at"] : null,
  featured: r["featured"] === 1,
  readMinutes: readMinutes(Number(r["summary_chars"] ?? 0)),
});
/**
 * LIKE pattern for a search query, with % and _ escaped. D1 rejects LIKE patterns over 50 bytes ("LIKE or GLOB pattern
 * too complex"), so the query is cut to fit: a prefix still matches everything the full query would.
 */
export function likePattern(q: string): string {
  const enc = new TextEncoder();
  let body = "";
  let bytes = 2; // the two % wildcards
  for (const ch of q) {
    const part = /[\\%_]/.test(ch) ? `\\${ch}` : ch;
    const n = enc.encode(part).length;
    if (bytes + n > 50) break;
    body += part;
    bytes += n;
  }
  return `%${body}%`;
}
const like = likePattern;

export function createNewsReader(db: D1DatabaseLike | null) {
  async function safe<T>(empty: T, fn: (db: D1DatabaseLike) => Promise<T>): Promise<T> {
    if (!db) return empty;
    try {
      return await fn(db);
    } catch (e) {
      if (missingSchema(e)) return empty;
      throw e;
    }
  }
  return {
    /** One page of published news, newest first; `hasMore` comes from reading one extra row (no count query). */
    list(opts: {
      page: number;
      category?: NewsCategory | null;
      q?: string;
    }): Promise<NewsListPage> {
      const page = opts.page;
      return safe({ items: [], page, hasMore: false }, async (d) => {
        const where = ["a.status = 'published'"];
        const params: unknown[] = [];
        if (opts.category) {
          where.push("a.category = ?");
          params.push(opts.category);
        }
        if (opts.q) {
          where.push(
            `(a.title LIKE ? ESCAPE '\\' OR a.card_description LIKE ? ESCAPE '\\' OR a.source_name LIKE ? ESCAPE '\\'
              OR a.summary LIKE ? ESCAPE '\\')`,
          );
          const pat = like(opts.q);
          params.push(pat, pat, pat, pat);
        }
        const { results } = await d
          .prepare(
            `SELECT ${CARD} FROM news_articles a WHERE ${where.join(" AND ")}
              ORDER BY a.published_at DESC, a.id LIMIT ? OFFSET ?`,
          )
          .bind(...params, NEWS_PAGE_SIZE + 1, (page - 1) * NEWS_PAGE_SIZE)
          .all<Row>();
        return {
          items: results.slice(0, NEWS_PAGE_SIZE).map(card),
          page,
          hasMore: results.length > NEWS_PAGE_SIZE,
        };
      });
    },

    /**
     * Trending: published in the last 7 days, ranked by editor's pick, then by how many sources reported the same
     * story (coverage_count, raised by duplicate detection), then by date. No per-view writes.
     */
    trending(now: Date, limit = 5): Promise<NewsCard[]> {
      return safe([], async (d) => {
        const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
        const { results } = await d
          .prepare(
            `SELECT ${CARD} FROM news_articles a WHERE a.status = 'published' AND a.published_at > ?
              ORDER BY a.featured DESC, a.coverage_count DESC, a.published_at DESC LIMIT ?`,
          )
          .bind(since, limit)
          .all<Row>();
        return results.map(card);
      });
    },

    /** The newest published articles across every category (the listings' "Latest updates" rail). */
    latest(limit = 8): Promise<NewsCard[]> {
      return safe([], async (d) => {
        const { results } = await d
          .prepare(
            `SELECT ${CARD} FROM news_articles a WHERE a.status = 'published'
              ORDER BY a.published_at DESC, a.id LIMIT ?`,
          )
          .bind(limit)
          .all<Row>();
        return results.map(card);
      });
    },

    /** Published articles per category; a category without any is absent. */
    categoryCounts(): Promise<Partial<Record<NewsCategory, number>>> {
      return safe({}, async (d) => {
        const { results } = await d
          .prepare(
            `SELECT a.category AS category, COUNT(*) AS n FROM news_articles a
              WHERE a.status = 'published' GROUP BY a.category`,
          )
          .all<Row>();
        const out: Partial<Record<NewsCategory, number>> = {};
        for (const r of results) out[String(r["category"]) as NewsCategory] = Number(r["n"] ?? 0);
        return out;
      });
    },

    item(slug: string): Promise<NewsDetail | null> {
      return safe(null, async (d) => {
        const r = await d
          .prepare(
            `SELECT ${DETAIL} FROM news_articles a JOIN news_sources s ON s.id = a.source_id
              WHERE a.slug = ? AND a.status = 'published'`,
          )
          .bind(slug)
          .first<Row>();
        if (!r) return null;
        return {
          ...card(r),
          summary: String(r["summary"] ?? ""),
          takeaways: stringList(r["takeaways"]),
          tags: stringList(r["tags"]),
          companies: stringList(r["companies"]),
          products: stringList(r["products"]),
          canonicalUrl: String(r["canonical_url"]),
          sourceSiteUrl: typeof r["site_url"] === "string" ? r["site_url"] : null,
          collectedAt: String(r["collected_at"] ?? ""),
          updatedAt: String(r["updated_at"] ?? ""),
        };
      });
    },

    related(slug: string, category: NewsCategory, limit = 3): Promise<NewsCard[]> {
      return safe([], async (d) => {
        const { results } = await d
          .prepare(
            `SELECT ${CARD} FROM news_articles a WHERE a.status = 'published' AND a.category = ? AND a.slug <> ?
              ORDER BY a.published_at DESC LIMIT ?`,
          )
          .bind(category, slug, limit)
          .all<Row>();
        return results.map(card);
      });
    },
  };
}

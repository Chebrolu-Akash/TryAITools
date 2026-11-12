// SERVER ONLY. Reads the published entries of the content sections from D1 with explicit PUBLIC column lists: a guest
// article's contributor_email, payment_status and payment_ref are never selected, so they cannot reach a page.
//
// Small by design: one indexed query per page (status = 'published'), at most LIST_LIMIT rows for a listing. A database
// without the content tables (migration 0004/0005 not applied yet) reads as "no entries", not as an error.
import type { D1DatabaseLike } from "@/lib/db/types";
import { mediaUrl } from "@/lib/media";
import {
  readingMinutes,
  type ContentDetail,
  type ContentList,
  type ContentSection,
  type PublicImage,
} from "./model";

export const LIST_LIMIT = 200;
type Row = Record<string, unknown>;

const s = (v: unknown) => (typeof v === "string" && v ? v : null);
const list = (v: unknown): string[] => {
  try {
    const x: unknown = typeof v === "string" ? JSON.parse(v) : null;
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
};
const retailers = (v: unknown) => {
  try {
    const x: unknown = typeof v === "string" ? JSON.parse(v) : null;
    return Array.isArray(x)
      ? x.flatMap((r: { name?: unknown; url?: unknown }) =>
          typeof r?.name === "string" && typeof r.url === "string" && r.url.startsWith("https://")
            ? [{ name: r.name, url: r.url }]
            : [],
        )
      : [];
  } catch {
    return [];
  }
};
const https = (v: unknown) => (typeof v === "string" && v.startsWith("https://") ? v : null);
const image = (r: Row, alt: unknown): PublicImage | null => {
  const url = mediaUrl(r["image_id"], r["image_mime"]);
  return url
    ? {
        url,
        alt: s(alt) ?? s(r["image_alt"]) ?? "",
        width: typeof r["image_w"] === "number" ? r["image_w"] : null,
        height: typeof r["image_h"] === "number" ? r["image_h"] : null,
      }
    : null;
};
const MEDIA_COLS =
  "m.mime AS image_mime, m.alt AS image_alt, m.width AS image_w, m.height AS image_h";

/** Per section: the FROM clause, the public columns of a card and of a detail page, the listing order. */
const Q = {
  courses: {
    from: "courses x LEFT JOIN media m ON m.id = x.image_id",
    card: `x.slug, x.title, x.kind, x.provider_or_author, x.summary, x.level, x.format, x.duration, x.price_text,
           x.is_free, x.affiliate_url, x.topics, x.featured, x.image_id, x.published_at, x.updated_at, ${MEDIA_COLS}`,
    detail:
      "x.review_md AS body, x.indexing, x.seo_title, x.seo_description, NULL AS canonical_url",
    order: "x.featured DESC, x.sort_order, x.published_at DESC",
  },
  tutorials: {
    from: "tutorials x LEFT JOIN media m ON m.id = x.image_id",
    card: `x.slug, x.title, x.author_or_provider, x.summary, x.difficulty, x.format, x.duration, x.resource_url,
           x.is_affiliate, x.is_free, x.topics, x.featured, x.image_id, x.published_at, x.updated_at, ${MEDIA_COLS}`,
    detail: "x.body_md AS body, x.indexing, x.seo_title, x.seo_description, NULL AS canonical_url",
    order: "x.featured DESC, x.sort_order, x.published_at DESC",
  },
  gadgets: {
    from: "gadgets x LEFT JOIN media m ON m.id = x.image_id",
    card: `x.slug, x.title, x.brand, x.gadget_type, x.summary, x.features, x.price_text, x.retailer, x.affiliate_url,
           x.alt_retailers, x.featured, x.image_id, x.published_at, x.updated_at, ${MEDIA_COLS}`,
    detail:
      "x.review_md AS body, x.indexing, x.seo_title, x.seo_description, NULL AS canonical_url",
    order: "x.featured DESC, x.sort_order, x.published_at DESC",
  },
  "guest-articles": {
    from: "guest_articles x LEFT JOIN media m ON m.id = x.cover_image_id",
    card: `x.slug, x.title, x.excerpt, x.topic, x.contributor_name, x.sponsor_name, x.sponsor_label,
           x.cover_image_id AS image_id, x.cover_alt, x.published_at, x.updated_at, ${MEDIA_COLS}`,
    detail:
      "x.body_md AS body, x.sponsor_url, x.indexing, x.seo_title, x.seo_description, x.canonical_url",
    order: "x.published_at DESC",
  },
  blog: {
    from: "blog_posts x LEFT JOIN media m ON m.id = x.cover_image_id",
    card: `x.slug, x.title, x.excerpt, x.author_name, x.tags, length(x.body_md) AS body_len,
           x.cover_image_id AS image_id, x.cover_alt, x.published_at, x.updated_at, ${MEDIA_COLS}`,
    detail:
      "x.body_md AS body, 'index' AS indexing, x.seo_title, x.seo_description, x.canonical_url",
    order: "x.published_at DESC",
  },
} as const satisfies Record<
  ContentSection,
  { from: string; card: string; detail: string; order: string }
>;

function card(section: ContentSection, r: Row) {
  const base = {
    slug: String(r["slug"]),
    title: String(r["title"]),
    publishedAt: String(r["published_at"] ?? ""),
    updatedAt: String(r["updated_at"] ?? ""),
  };
  switch (section) {
    case "courses":
      return {
        ...base,
        image: image(r, null),
        kind: r["kind"] === "book" ? ("book" as const) : ("course" as const),
        provider: s(r["provider_or_author"]),
        summary: s(r["summary"]),
        level: (["beginner", "intermediate", "advanced"].includes(String(r["level"]))
          ? r["level"]
          : "all") as "beginner" | "intermediate" | "advanced" | "all",
        format: s(r["format"]),
        duration: s(r["duration"]),
        price: s(r["price_text"]),
        isFree: r["is_free"] === 1,
        url: https(r["affiliate_url"]),
        topics: list(r["topics"]),
        featured: r["featured"] === 1,
      };
    case "tutorials":
      return {
        ...base,
        image: image(r, null),
        author: s(r["author_or_provider"]),
        summary: s(r["summary"]),
        difficulty: (["intermediate", "advanced"].includes(String(r["difficulty"]))
          ? r["difficulty"]
          : "beginner") as "beginner" | "intermediate" | "advanced",
        format: s(r["format"]),
        duration: s(r["duration"]),
        url: https(r["resource_url"]),
        isAffiliate: r["is_affiliate"] === 1,
        isFree: r["is_free"] === 1,
        topics: list(r["topics"]),
        featured: r["featured"] === 1,
      };
    case "gadgets":
      return {
        ...base,
        image: image(r, null),
        brand: s(r["brand"]),
        type: String(r["gadget_type"] ?? "other"),
        summary: s(r["summary"]),
        features: list(r["features"]),
        price: s(r["price_text"]),
        retailer: s(r["retailer"]),
        url: https(r["affiliate_url"]),
        otherRetailers: retailers(r["alt_retailers"]),
        featured: r["featured"] === 1,
      };
    case "guest-articles":
      return {
        ...base,
        image: image(r, r["cover_alt"]),
        excerpt: s(r["excerpt"]),
        topic: s(r["topic"]),
        contributor: String(r["contributor_name"] ?? ""),
        sponsor: String(r["sponsor_name"] ?? ""),
        sponsorLabel: s(r["sponsor_label"]) ?? "Sponsored",
      };
    case "blog":
      return {
        ...base,
        image: image(r, r["cover_alt"]),
        excerpt: s(r["excerpt"]),
        author: s(r["author_name"]),
        tags: list(r["tags"]),
        minutes: readingMinutes(Number(r["body_len"] ?? 0)),
      };
  }
}

/** True for "this database has no such table/column yet": treated as an empty section. */
export const missingSchema = (e: unknown) =>
  /no such (table|column)/i.test(e instanceof Error ? e.message : String(e));

export function createContentReader(db: D1DatabaseLike | null) {
  return {
    async list<S extends ContentSection>(section: S): Promise<ContentList[S]> {
      if (!db) return [] as ContentList[S];
      const q = Q[section];
      try {
        const rows = (
          await db
            .prepare(
              `SELECT ${q.card} FROM ${q.from} WHERE x.status = 'published' ORDER BY ${q.order} LIMIT ?`,
            )
            .bind(LIST_LIMIT)
            .all<Row>()
        ).results;
        return rows.map((r) => card(section, r)) as ContentList[S];
      } catch (e) {
        if (missingSchema(e)) return [] as ContentList[S];
        throw e;
      }
    },

    /**
     * Up to `limit` other published entries of the same section (and, for courses, the same kind), for "related"
     * links on a detail page. One small indexed read.
     */
    async related<S extends ContentSection>(
      section: S,
      slug: string,
      opts: { kind?: "course" | "book"; limit?: number } = {},
    ): Promise<ContentList[S]> {
      if (!db) return [] as ContentList[S];
      const q = Q[section];
      const kind = section === "courses" && opts.kind ? " AND x.kind = ?" : "";
      try {
        const rows = (
          await db
            .prepare(
              `SELECT ${q.card} FROM ${q.from} WHERE x.status = 'published' AND x.slug <> ?${kind} ORDER BY ${q.order} LIMIT ?`,
            )
            .bind(slug, ...(kind ? [opts.kind] : []), opts.limit ?? 3)
            .all<Row>()
        ).results;
        return rows.map((r) => card(section, r)) as ContentList[S];
      } catch (e) {
        if (missingSchema(e)) return [] as ContentList[S];
        throw e;
      }
    },

    async item<S extends ContentSection>(
      section: S,
      slug: string,
    ): Promise<ContentDetail[S] | null> {
      if (!db) return null;
      const q = Q[section];
      let r: Row | null;
      try {
        r = await db
          .prepare(
            `SELECT ${q.card}, ${q.detail} FROM ${q.from} WHERE x.slug = ? AND x.status = 'published'`,
          )
          .bind(slug)
          .first<Row>();
      } catch (e) {
        if (missingSchema(e)) return null;
        throw e;
      }
      if (!r) return null;
      const body = String(r["body"] ?? "");
      return {
        ...card(section, r),
        body,
        indexable: r["indexing"] === "index",
        seoTitle: s(r["seo_title"]),
        seoDescription: s(r["seo_description"]),
        canonical: s(r["canonical_url"]),
        ...(section === "guest-articles" ? { sponsorUrl: https(r["sponsor_url"]) } : {}),
      } as ContentDetail[S];
    },
  };
}

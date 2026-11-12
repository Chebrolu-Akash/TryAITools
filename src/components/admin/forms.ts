// Pure helpers that convert between API records and editable form state. No side effects, so the
// payloads they build can be validated against the server's own schemas in tests.
import { mediaUrl } from "@/lib/media";
import { readPricingPlans, type PricingPlans } from "@/lib/pricing-plans";

export const linesToList = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
export const listToLines = (v: unknown): string => (Array.isArray(v) ? v.join("\n") : "");
export const csvToList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
export const listToCsv = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : "");
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const newClientId = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// ---- tools

export type ToolForm = {
  slug: string;
  name: string;
  display_name: string;
  url: string;
  category_id: string;
  subcategory: string;
  tagsText: string;
  logo_url: string;
  tagline: string;
  overview: string;
  best_for: string;
  featuresText: string;
  prosText: string;
  limitsText: string;
  stepsText: string;
  tipsText: string;
  platformsText: string;
  pricing_note: string;
  pricing_source: string;
  /** "" = not recorded */
  pricing_model: string;
  /** detailed plans for the public page; null = none */
  pricing_plans: PricingPlans | null;
  /** YYYY-MM-DD, "" = not recorded */
  pricing_checked_at: string;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  og_image_url: string;
  indexing: "index" | "noindex";
};

export const emptyToolForm = (category_id = ""): ToolForm => ({
  slug: "",
  name: "",
  display_name: "",
  url: "",
  category_id,
  subcategory: "",
  tagsText: "",
  logo_url: "",
  tagline: "",
  overview: "",
  best_for: "",
  featuresText: "",
  prosText: "",
  limitsText: "",
  stepsText: "",
  tipsText: "",
  platformsText: "",
  pricing_note: "",
  pricing_source: "",
  pricing_model: "",
  pricing_plans: null,
  pricing_checked_at: "",
  seo_title: "",
  seo_description: "",
  canonical_url: "",
  og_image_url: "",
  indexing: "noindex",
});

export function toolFormFromApi(t: Record<string, unknown>): ToolForm {
  return {
    slug: str(t.slug),
    name: str(t.name),
    display_name: str(t.display_name),
    url: str(t.url),
    category_id: str(t.category_id),
    subcategory: str(t.subcategory),
    tagsText: listToCsv(t.tags),
    logo_url: str(t.logo_url),
    tagline: str(t.tagline),
    overview: str(t.overview),
    best_for: str(t.best_for),
    featuresText: listToLines(t.features),
    prosText: listToLines(t.pros),
    limitsText: listToLines(t.limits),
    stepsText: listToLines(t.steps),
    tipsText: listToLines(t.tips),
    platformsText: listToCsv(t.platforms),
    pricing_note: str(t.pricing_note),
    pricing_source: str(t.pricing_source),
    pricing_model: str(t.pricing_model),
    pricing_plans: readPricingPlans(t["pricing_plans"]),
    pricing_checked_at: str(t["pricing_checked_at"]),
    seo_title: str(t.seo_title),
    seo_description: str(t.seo_description),
    canonical_url: str(t.canonical_url),
    og_image_url: str(t.og_image_url),
    indexing: t.indexing === "index" ? "index" : "noindex",
  };
}

/** Editable fields only (never status, needs_review or slug of an existing tool: those change through actions). */
export function toolPayload(f: ToolForm) {
  return {
    name: f.name,
    display_name: f.display_name,
    url: f.url,
    category_id: f.category_id,
    subcategory: f.subcategory,
    tags: csvToList(f.tagsText),
    logo_url: f.logo_url,
    tagline: f.tagline,
    overview: f.overview,
    best_for: f.best_for,
    features: linesToList(f.featuresText),
    pros: linesToList(f.prosText),
    limits: linesToList(f.limitsText),
    steps: linesToList(f.stepsText),
    tips: linesToList(f.tipsText),
    pricing_note: f.pricing_note,
    pricing_source: f.pricing_source,
    pricing_model: f.pricing_model || null,
    pricing_plans: f.pricing_plans?.groups.length ? f.pricing_plans : null,
    pricing_checked_at: f.pricing_checked_at || null,
    platforms: csvToList(f.platformsText),
    seo_title: f.seo_title,
    seo_description: f.seo_description,
    canonical_url: f.canonical_url,
    og_image_url: f.og_image_url,
    indexing: f.indexing,
  };
}

// ---- categories

export type CategoryForm = {
  slug: string;
  name: string;
  description: string;
  subcategoriesText: string;
  sort_order: string;
  status: "draft" | "published" | "archived";
  indexing: "index" | "noindex";
  seo_title: string;
  seo_description: string;
};
export const emptyCategoryForm = (): CategoryForm => ({
  slug: "",
  name: "",
  description: "",
  subcategoriesText: "",
  sort_order: "0",
  status: "draft",
  indexing: "noindex",
  seo_title: "",
  seo_description: "",
});
export const categoryFormFromApi = (c: Record<string, unknown>): CategoryForm => ({
  slug: str(c.slug),
  name: str(c.name),
  description: str(c.description),
  subcategoriesText: listToLines(c.subcategories),
  sort_order: String(c.sort_order ?? 0),
  status: (["draft", "published", "archived"].includes(str(c.status))
    ? c.status
    : "draft") as CategoryForm["status"],
  indexing: c.indexing === "index" ? "index" : "noindex",
  seo_title: str(c.seo_title),
  seo_description: str(c.seo_description),
});
export const categoryPayload = (f: CategoryForm) => ({
  name: f.name,
  description: f.description,
  subcategories: linesToList(f.subcategoriesText),
  sort_order: Number(f.sort_order),
  status: f.status,
  indexing: f.indexing,
  seo_title: f.seo_title,
  seo_description: f.seo_description,
});

// ---- blog

export type PostForm = {
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  author_name: string;
  tagsText: string;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  cover: { id: string; url: string } | null;
  cover_alt: string;
};
export const emptyPostForm = (): PostForm => ({
  slug: "",
  title: "",
  excerpt: "",
  body_md: "",
  author_name: "",
  tagsText: "",
  seo_title: "",
  seo_description: "",
  canonical_url: "",
  cover: null,
  cover_alt: "",
});
export const postFormFromApi = (p: Record<string, unknown>): PostForm => ({
  slug: str(p.slug),
  title: str(p.title),
  excerpt: str(p.excerpt),
  body_md: str(p.body_md),
  author_name: str(p.author_name),
  tagsText: listToCsv(p.tags),
  seo_title: str(p.seo_title),
  seo_description: str(p.seo_description),
  canonical_url: str(p.canonical_url),
  cover: (() => {
    const url = mediaUrl(p.cover_image_id, p.cover_mime);
    return url ? { id: String(p.cover_image_id), url } : null;
  })(),
  cover_alt: str(p.cover_alt),
});
export const postPayload = (f: PostForm) => ({
  title: f.title,
  excerpt: f.excerpt,
  body_md: f.body_md,
  author_name: f.author_name,
  tags: csvToList(f.tagsText),
  seo_title: f.seo_title,
  seo_description: f.seo_description,
  canonical_url: f.canonical_url,
  cover_image_id: f.cover?.id ?? null,
  cover_alt: f.cover_alt,
});

export const isDirty = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

// The indexing gate (approved D4): a tool may be indexed only when every check passes. Used by bulk "enable indexing"
// and by approving a reviewed draft. It never fabricates anything: it only reads what is stored.
import { isSafeHttpUrl } from "./validation";

export type GateTool = {
  status: string;
  needs_review: number | boolean;
  category_status?: string | null;
  review_status?: string | null;
  url?: string | null;
  url_status?: string | null;
  overview?: string | null;
  tagline?: string | null;
  features?: unknown;
  pricing_model?: string | null;
  pricing_checked_at?: string | null;
};

const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};
const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/**
 * Reasons the tool cannot be indexed (empty = it can). `otherIndexedSameProduct` is true when another indexed listing
 * already represents the same product (one indexable page per product).
 */
export function indexGate(t: GateTool, otherIndexedSameProduct = false): string[] {
  const why: string[] = [];
  if (t.status !== "published") why.push("not published");
  if (Number(t.needs_review) === 1) why.push("flagged for review");
  if (t.category_status && t.category_status !== "published") why.push("category not published");
  if (t.review_status !== "reviewed") why.push("not reviewed");
  if (!filled(t.url) || !isSafeHttpUrl(String(t.url))) why.push("no valid official URL");
  if (t.url_status === "dead" || t.url_status === "error") why.push("official URL not reachable");
  if (!filled(t.overview) && !filled(t.tagline)) why.push("no overview");
  if (list(t.features).length === 0) why.push("no verified features");
  if (!filled(t.pricing_model) && !filled(t.pricing_checked_at))
    why.push("pricing neither verified nor recorded as unknown");
  if (otherIndexedSameProduct) why.push("another listing of this product is already indexed");
  return why;
}

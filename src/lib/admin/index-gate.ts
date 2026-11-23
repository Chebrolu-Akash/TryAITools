// The indexing gate (approved G1–G10). A tool may be switched to indexing = 'index' only when every check passes. It runs
// on the server in EVERY path that can index a tool: the tool editor's save, the "Enable indexing" action, bulk editing
// and bulk undo. There is no override. It never fabricates anything: it only reads what is stored.
//
// Already indexed tools (the 27 curated before this gate existed) are not re-gated on unrelated edits; instead an edit
// may not ADD a failing check they did not have before ("no regression", see gateDecision).
import { unsupportedPricingClaims } from "@/lib/tools/pricing-claims";
import { overlap, ownText, shingles, wordCount } from "./similarity";
import { isSafeHttpUrl } from "./validation";

export type GateTool = {
  slug?: string;
  name?: string | null;
  category_id?: string | null;
  status: string;
  needs_review: number | boolean;
  category_status?: string | null;
  review_status?: string | null;
  reviewed_at?: string | null;
  url?: string | null;
  url_status?: string | null;
  url_checked_at?: string | null;
  overview?: string | null;
  tagline?: string | null;
  best_for?: string | null;
  features?: unknown;
  pros?: unknown;
  limits?: unknown;
  pricing_model?: string | null;
  pricing_note?: string | null;
  pricing_source?: string | null;
  pricing_checked_at?: string | null;
  review_sources?: unknown;
};

/** What the approval stored in tools.review_sources (version 2). Older rows (a plain list of sources) have no evidence. */
export type ReviewRecord = {
  version: 2;
  sources: { url: string; checked_at: string; kind?: string }[];
  evidence: {
    features: string[];
    pros: string[];
    limits: string[];
    best_for: string[];
    pricing: string;
  };
  /** Set when every quote above was found again in the stored official-page text at approval time. */
  quotes_verified_at: string | null;
  /** The pricing that was already verified before this review and was kept (the draft had no verified pricing). */
  pricing_kept: { model: string; source: string | null; checked_at: string | null } | null;
  identity: { matches: boolean; name_on_site: string; signals: string[] };
};

/** The latest approval of the tool (tool_review_history), if any and not reverted. */
export type Approval = {
  actor_email: string;
  at: string;
  checklist: {
    claims_checked?: boolean;
    own_wording?: boolean;
    pricing_confirmed?: boolean;
    category_confirmed?: boolean;
    category_id?: string | null;
  } | null;
};

export type GateContext = {
  now: string;
  /** The category template's generic "best for" line, which never counts as the tool's own use cases. */
  templateAudience?: string | null;
  /** Another indexed listing has the same product name. */
  sameProductIndexed?: string | null;
  /** Another indexed listing has the same official site (host). */
  sameSiteIndexed?: string | null;
  /** This listing is a feature variant of another published listing on the same site ("X Avatars" of "X"). */
  variantOf?: string | null;
  /** Own text of the other published tools in the same subcategory. */
  peers?: { slug: string; text: string }[];
  approval?: Approval | null;
};

export type GateFailure = { id: string; reason: string };

const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v) as unknown;
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};
const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const words = (v: unknown) => (typeof v === "string" ? wordCount(v) : 0);
const daysOld = (iso: string | null | undefined, now: string) => {
  if (!iso) return Infinity;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(t) ? (Date.parse(now) - t) / 86_400_000 : Infinity;
};
const quote = (q: unknown) => typeof q === "string" && wordCount(q) >= 3;

export function reviewRecord(v: unknown): ReviewRecord | null {
  let x: unknown = v;
  if (typeof v === "string") {
    try {
      x = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Partial<ReviewRecord>;
  return r.version === 2 && r.evidence && r.identity ? (r as ReviewRecord) : null;
}

export const OVERLAP_MAX = 0.5;
export const OWN_WORDS_MIN = 120;
export const URL_MAX_DAYS = 30;
export const UNKNOWN_PRICING_MAX_DAYS = 90;

/** Every failing check, named (empty = the tool may be indexed). */
export function gateFailures(t: GateTool, c: GateContext): GateFailure[] {
  const f: GateFailure[] = [];
  const add = (id: string, reason: string) => f.push({ id, reason: `${id}: ${reason}` });
  const rec = reviewRecord(t.review_sources);
  const ev = rec?.evidence;

  // base rules (unchanged)
  if (t.status !== "published") add("base", "not published");
  if (Number(t.needs_review) === 1) add("base", "flagged for review");
  if (t.category_status && t.category_status !== "published") add("base", "category not published");
  if (!filled(t.url) || !isSafeHttpUrl(String(t.url))) add("base", "no valid official URL");

  // G1 overview and tagline
  const tw = words(t.tagline);
  const ow = words(t.overview);
  if (tw < 3 || tw > 12) add("G1", `tagline has ${tw} words (needs 3–12)`);
  if (ow < 45 || ow > 110) add("G1", `overview has ${ow} words (needs 45–110)`);
  if (/we haven't reviewed|is listed under ai /i.test(String(t.overview ?? "")))
    add("G1", "overview is the category template text");

  // G2 verified features
  const feats = list(t.features).filter(filled);
  if (feats.length < 3) add("G2", `${feats.length} feature(s) (needs at least 3)`);
  else if (!ev || ev.features.length !== feats.length || !ev.features.every(quote))
    add("G2", "not every feature has its official-page quote");
  else if (!rec?.quotes_verified_at)
    add("G2", "the quotes were not re-verified against the official pages");

  // G3 tool-specific use cases
  const useCases = ev?.best_for ?? [];
  if (!filled(t.best_for)) add("G3", "no tool-specific use cases (best for)");
  else if (c.templateAudience && t.best_for!.trim() === c.templateAudience.trim())
    add("G3", "best for is the category template line");
  else if (useCases.length < 2 || useCases.length > 4 || !useCases.every(quote))
    add("G3", `needs 2–4 use cases with quotes (has ${useCases.length})`);

  // G4 pricing settled
  const model = t.pricing_model ?? null;
  if (model) {
    const evidenced =
      quote(ev?.pricing) || (rec?.pricing_kept?.model === model && !!rec.pricing_kept.source);
    if (!filled(t.pricing_source) || !isSafeHttpUrl(String(t.pricing_source)))
      add("G4", "pricing model has no pricing source URL");
    else if (!evidenced) add("G4", "pricing model has no evidence quote");
    else if (!t.pricing_checked_at) add("G4", "pricing has no check date");
  } else if (daysOld(t.pricing_checked_at, c.now) > UNKNOWN_PRICING_MAX_DAYS)
    add("G4", `pricing unknown and not checked in the last ${UNKNOWN_PRICING_MAX_DAYS} days`);

  // G5 pricing summary supported by its quote
  if (filled(t.pricing_note)) {
    const missing = unsupportedPricingClaims(String(t.pricing_note), ev?.pricing ?? "");
    if (missing.length) add("G5", `pricing summary states ${missing.join(", ")} not in its quote`);
  }

  // G6 URL and identity
  if (t.url_status !== "ok") add("G6", `URL status is ${t.url_status ?? "unchecked"}`);
  else if (daysOld(t.url_checked_at, c.now) > URL_MAX_DAYS)
    add("G6", `URL not checked in the last ${URL_MAX_DAYS} days`);
  if (!rec?.identity?.matches) add("G6", "identity of the official site not confirmed");
  else if (rec.identity.signals?.length)
    add("G6", `the official page shows: ${rec.identity.signals.join("; ")}`);

  // G7 one page per product
  if (c.sameProductIndexed)
    add("G7", `another listing of this product is indexed (${c.sameProductIndexed})`);
  if (c.sameSiteIndexed)
    add("G7", `another listing on the same site is indexed (${c.sameSiteIndexed})`);
  if (c.variantOf) add("G7", `feature-variant listing of ${c.variantOf}`);

  // G8 unique content
  const own = ownText(t);
  const ownWords = wordCount(own);
  if (ownWords < OWN_WORDS_MIN) add("G8", `${ownWords} words of own text (needs ${OWN_WORDS_MIN})`);
  else {
    const mine = shingles(own);
    for (const p of c.peers ?? []) {
      const o = overlap(mine, shingles(p.text));
      if (o > OVERLAP_MAX) {
        add(
          "G8",
          `${Math.round(o * 100)}% of its text overlaps ${p.slug} (max ${OVERLAP_MAX * 100}%)`,
        );
        break;
      }
    }
  }

  // G9 editor approval
  if (t.review_status !== "reviewed" || !t.reviewed_at) add("G9", "not reviewed");
  else if (!c.approval?.actor_email) add("G9", "no recorded editor approval");

  // G10 category confirmed
  const cl = c.approval?.checklist;
  if (!cl?.category_confirmed) add("G10", "category not confirmed by the editor");
  else if (cl.category_id && t.category_id && cl.category_id !== t.category_id)
    add("G10", "category changed since it was confirmed");

  return f;
}

/** Reasons the tool cannot be indexed (empty = it can). */
export const indexGate = (t: GateTool, c: GateContext): string[] =>
  gateFailures(t, c).map((x) => x.reason);

/**
 * Whether a change may leave the tool indexed. Newly indexed: every check must pass. Already indexed and staying
 * indexed: the change may not add a failing check the tool did not already have (no regression).
 */
export function gateDecision(
  wasIndexed: boolean,
  before: GateFailure[],
  after: GateFailure[],
): string[] {
  if (!wasIndexed) return after.map((x) => x.reason);
  const hadIds = new Set(before.map((x) => x.id));
  return after
    .filter((x) => !hadIds.has(x.id))
    .map((x) => `${x.reason} (the tool is indexed; this change would make it fail)`);
}

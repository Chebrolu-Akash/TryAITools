// Review drafts in the admin (approved plan D2/D4, workflow G1–G10).
//   Generate: fetch the official pages, ask Gemini (free tier), store the grounded draft (never public).
//   Approve:  the editor may edit every claim first (but cannot add a claim without its official-page quote), ticks the
//             checklist, and the edited content becomes the tool's content. The previous values are stored in
//             tool_review_history so the approval can be reverted exactly. Approval NEVER changes indexing.
//   Reject:   keep the tool as it was and send it to manual review.
//   Revert:   restore the values from before the approval and force noindex.
import * as z from "zod";
import { grounded, generateDraft, type ReviewDraft } from "@/lib/tools/review-draft";
import { unsupportedPricingClaims } from "@/lib/tools/pricing-claims";
import {
  auditStep,
  catalogVersionStep,
  HttpError,
  readSafe,
  writeBatch,
  type WriteStep,
} from "./db";
import type { ReviewRecord } from "./index-gate";
import { wordCount } from "./similarity";
import { need, parseJson, type Ctx, type Row } from "./repo";

export const draftDecisionSchema = z.object({ updated_at: z.string().min(10).max(40) }).strict();

const claim = z
  .object({ text: z.string().trim().min(1).max(200), ref: z.number().int().min(0).max(9) })
  .strict();
export const approveSchema = z
  .object({
    updated_at: z.string().min(10).max(40),
    content: z
      .object({
        tagline: z.string().trim().max(160),
        overview: z.string().trim().max(1200),
        features: z.array(claim).max(6),
        best_for: z.array(claim).max(4),
        pros: z.array(claim).max(4),
        limits: z.array(claim).max(3),
        pricing: z
          .object({
            choice: z.enum(["draft", "kept", "unknown"]),
            summary: z.string().trim().max(300),
          })
          .strict(),
        seo_title: z.string().trim().max(70),
        seo_description: z.string().trim().max(170),
      })
      .strict()
      .optional(),
    checklist: z
      .object({
        claims_checked: z.literal(true),
        own_wording: z.literal(true),
        pricing_confirmed: z.literal(true),
        category_confirmed: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** Every field an approval writes, as stored before/after it (revert restores exactly these). */
export const SNAPSHOT_FIELDS = [
  "tagline",
  "overview",
  "best_for",
  "features",
  "pros",
  "limits",
  "pricing_model",
  "pricing_note",
  "pricing_source",
  "pricing_checked_at",
  "seo_title",
  "seo_description",
  "review_sources",
  "review_status",
  "reviewed_at",
  "review_draft",
  "review_notes",
  "content_source",
  "indexing",
] as const;
type Snapshot = Record<(typeof SNAPSHOT_FIELDS)[number], unknown>;
const snapshotOf = (t: Row): Snapshot =>
  Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, t[k] ?? null])) as Snapshot;

const toolRow = async (ctx: Ctx, slug: string) => {
  const d = need(ctx.db);
  const r = await readSafe(() =>
    d
      .prepare(
        "SELECT t.*, c.name AS category_name FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = ?",
      )
      .bind(slug)
      .first<Row>(),
  );
  if (!r) throw new HttpError(404, "not_found", "Tool not found.");
  return r;
};

const hostOf = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

export type DraftDeps = { apiKey: string | null; model?: string | undefined; fetch?: typeof fetch };

/** Generates and stores a draft. 503 (and nothing stored) when the free quota or the key is the problem. */
export async function generateToolDraft(ctx: Ctx, slug: string, deps: DraftDeps) {
  if (!deps.apiKey)
    throw new HttpError(
      503,
      "ai_not_configured",
      "GEMINI_API_KEY is not set for this environment. Nothing was changed.",
    );
  const t = await toolRow(ctx, slug);
  if (typeof t["url"] !== "string" || !t["url"])
    throw new HttpError(422, "no_url", "This tool has no official URL to review.");
  let r: Awaited<ReturnType<typeof generateDraft>>;
  try {
    r = await generateDraft(
      {
        name: String(t["name"]),
        url: String(t["url"]),
        category: String(t["category_name"]),
        subcategory: (t["subcategory"] as string | null) ?? null,
      },
      {
        apiKey: deps.apiKey,
        ...(deps.model ? { model: deps.model } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        now: ctx.now,
      },
    );
  } catch (e) {
    // never a bare 500: the editor sees why, and nothing is stored
    const why = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : "unknown error";
    console.error("review draft failed", slug, why);
    throw new HttpError(
      503,
      "ai_unavailable",
      `Draft generation failed (${why}). Nothing was changed.`,
    );
  }
  if (!r.ok && r.deferred)
    throw new HttpError(
      503,
      // 429 = the free quota; other stop-run errors are key/model/request problems (every tool would fail the same way)
      /\(429\)/.test(r.reason) ? "ai_quota" : r.stopRun ? "ai_config" : "ai_unavailable",
      `${r.reason}. Nothing was changed; try again later.`,
    );
  const d = need(ctx.db);
  const draft: ReviewDraft | null = r.ok ? r.draft : null;
  const status = draft ? draft.quality.status : "needs_manual";
  const notes = draft
    ? draft.quality.reasons.join("; ") || null
    : `automated review failed: ${r.ok ? "" : r.reason}`;
  // The official homepage was just fetched: record its health (same site = ok, another site = redirect).
  const urlStatus = r.ok
    ? r.finalUrl && hostOf(r.finalUrl) !== hostOf(t["url"])
      ? "redirect"
      : "ok"
    : (t["url_status"] ?? null);
  await writeBatch(d, [
    {
      sql: "UPDATE tools SET review_draft = ?, review_status = CASE WHEN review_status = 'reviewed' THEN 'reviewed' ELSE ? END, review_notes = ?, url_status = ?, url_checked_at = ?, updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [
        draft ? JSON.stringify(draft) : null,
        status,
        notes,
        urlStatus,
        ctx.now,
        ctx.now,
        slug,
        t["updated_at"],
      ],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      "tool.review_draft",
      "tool",
      slug,
      draft ? `Generated review draft (${status})` : `Review draft failed: ${notes ?? ""}`,
      ctx.now,
      {
        table: "tools",
        key: "slug",
        value: slug,
        stamp: "updated_at",
      },
    ),
  ]);
  return { status, draft, reason: r.ok ? null : r.reason };
}

/** The history row is written in the same atomic batch, guarded so it only lands if the tool update did. */
const historyStep = (
  ctx: Ctx,
  t: Row,
  action: "approve" | "revert",
  before: Snapshot,
  after: Snapshot,
  checklist: unknown,
  draft: unknown,
): WriteStep => ({
  sql: `INSERT INTO tool_review_history (tool_id, slug, at, actor_email, action, before, after, checklist, draft)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tools WHERE id = ? AND updated_at = ?)`,
  params: [
    t["id"],
    t["slug"],
    ctx.now,
    ctx.actor,
    action,
    JSON.stringify(before),
    JSON.stringify(after),
    checklist === null ? null : JSON.stringify(checklist),
    draft === null ? null : JSON.stringify(draft),
    t["id"],
    ctx.now,
  ],
  expectChanges: 1,
});

/** Picks the claims the editor kept (by their index in the draft), with their edited text and their draft quote. */
function pick(
  edited: { text: string; ref: number }[] | undefined,
  texts: string[],
  quotes: string[],
  label: string,
): { text: string[]; evidence: string[] } {
  if (!edited) return { text: [...texts], evidence: [...quotes] };
  const seen = new Set<number>();
  const out = { text: [] as string[], evidence: [] as string[] };
  for (const c of edited) {
    if (c.ref >= texts.length || seen.has(c.ref))
      throw new HttpError(
        422,
        "unquoted_claim",
        `Each ${label} must come from the draft (with its official-page quote); new claims cannot be added here.`,
      );
    seen.add(c.ref);
    out.text.push(c.text);
    out.evidence.push(quotes[c.ref] ?? "");
  }
  return out;
}

/**
 * Approves a draft, optionally edited by the editor. Content becomes the tool's own; review_status = reviewed; the
 * previous values go to tool_review_history. Does NOT index the tool. Verified pricing is kept when the draft has none.
 */
export async function approveToolDraft(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof approveSchema>,
) {
  const t = await toolRow(ctx, slug);
  const draft = parseJson(t["review_draft"]) as ReviewDraft | null;
  if (!draft) throw new HttpError(409, "no_draft", "There is no draft to approve.");
  if (draft.quality.status !== "draft_ready")
    throw new HttpError(
      409,
      "draft_not_ready",
      `This draft needs manual work first: ${draft.quality.reasons.join("; ")}`,
    );
  const sourceText = (draft.sources ?? []).map((s) => s.text ?? "").join("\n");
  if (!sourceText.trim() || !Array.isArray(draft.best_for))
    throw new HttpError(
      409,
      "draft_outdated",
      "This draft was made before the current checks (it has no stored source text or use cases). Regenerate it.",
    );
  const c = input.content;
  const ev = draft.evidence;
  const features = pick(c?.features, draft.features, ev.features, "feature");
  const bestFor = pick(c?.best_for, draft.best_for, ev.best_for ?? [], "use case");
  const pros = pick(c?.pros, draft.pros, ev.pros, "advantage");
  const limits = pick(c?.limits, draft.limits, ev.limits, "limitation");

  // Every quote is checked again against the official-page text stored with the draft.
  const quotes = [...features.evidence, ...bestFor.evidence, ...pros.evidence, ...limits.evidence];
  const bad = quotes.filter((q) => !grounded(q, sourceText));
  if (bad.length)
    throw new HttpError(
      422,
      "ungrounded",
      `${bad.length} quote(s) are no longer found on the stored official pages. Regenerate the draft.`,
    );

  // Pricing: the draft's verified pricing, the pricing that was already verified (kept), or unknown.
  const existingModel = (t["pricing_model"] as string | null) ?? null;
  const choice =
    c?.pricing.choice ?? (draft.pricing.model ? "draft" : existingModel ? "kept" : "unknown");
  let pricing: {
    model: string | null;
    note: string | null;
    source: string | null;
    checked: string | null;
  };
  let pricingEvidence = "";
  let kept: ReviewRecord["pricing_kept"] = null;
  if (choice === "draft") {
    if (!draft.pricing.model)
      throw new HttpError(422, "no_draft_pricing", "The draft has no verified pricing to use.");
    const summary = c ? c.pricing.summary : draft.pricing.summary;
    const missing = unsupportedPricingClaims(summary, ev.pricing);
    if (missing.length)
      throw new HttpError(
        422,
        "pricing_unsupported",
        `The pricing summary states ${missing.join(", ")}, which its quote does not contain.`,
      );
    pricing = {
      model: draft.pricing.model,
      note: summary || null,
      source: draft.pricing.source_url,
      checked: draft.generated_at.slice(0, 10),
    };
    pricingEvidence = ev.pricing;
  } else if (choice === "kept") {
    if (!existingModel)
      throw new HttpError(422, "no_kept_pricing", "There is no verified pricing to keep.");
    pricing = {
      model: existingModel,
      note: (t["pricing_note"] as string | null) ?? null,
      source: (t["pricing_source"] as string | null) ?? null,
      checked: (t["pricing_checked_at"] as string | null) ?? null,
    };
    kept = {
      model: existingModel,
      source: pricing.source,
      checked_at: pricing.checked,
    };
  } else {
    // recorded as unknown, checked on the draft's date (an explicit editor choice when pricing was verified before)
    pricing = { model: null, note: null, source: null, checked: draft.generated_at.slice(0, 10) };
  }

  const record: ReviewRecord = {
    version: 2,
    sources: draft.sources.map((s) => ({ url: s.url, checked_at: s.checked_at, kind: s.kind })),
    evidence: {
      features: features.evidence,
      pros: pros.evidence,
      limits: limits.evidence,
      best_for: bestFor.evidence,
      pricing: pricingEvidence,
    },
    quotes_verified_at: ctx.now,
    pricing_kept: kept,
    identity: {
      matches: draft.quality.identity.matches,
      name_on_site: draft.quality.identity.name_on_site,
      signals: draft.quality.signals ?? [],
    },
  };
  // The editor's fixes (G1 lengths, a title that names the tool) must be made before approval.
  const finalTagline = (c ? c.tagline : draft.tagline) || "";
  const finalOverview = c ? c.overview : draft.overview;
  const finalTitle = (c ? c.seo_title : draft.seo_title) || "";
  const tw = wordCount(finalTagline);
  const ow = wordCount(finalOverview);
  const fix: string[] = [];
  if (tw < 3 || tw > 12) fix.push(`the tagline has ${tw} words (needs 3–12)`);
  if (ow < 45 || ow > 110) fix.push(`the overview has ${ow} words (needs 45–110)`);
  const brand = String(t["name"])
    .replace(/\s*\(.+\)$/, "")
    .split(" ")[0]!
    .toLowerCase();
  if (finalTitle && !finalTitle.toLowerCase().includes(brand))
    fix.push("the SEO title must name the tool");
  if (fix.length)
    throw new HttpError(422, "needs_fixes", `Fix before approving: ${fix.join("; ")}.`);
  const before = snapshotOf(t);
  const after: Snapshot = {
    ...before,
    tagline: (c ? c.tagline : draft.tagline) || null,
    overview: c ? c.overview : draft.overview,
    best_for: bestFor.text.join("; ") || null,
    features: JSON.stringify(features.text),
    pros: JSON.stringify(pros.text),
    limits: JSON.stringify(limits.text),
    pricing_model: pricing.model,
    pricing_note: pricing.note,
    pricing_source: pricing.source,
    pricing_checked_at: pricing.checked,
    seo_title: (c ? c.seo_title : draft.seo_title) || null,
    seo_description: (c ? c.seo_description : draft.seo_description) || null,
    review_sources: JSON.stringify(record),
    review_status: "reviewed",
    reviewed_at: ctx.now,
    review_draft: null,
    review_notes: null,
    content_source: "admin", // the page uses the stored best-for (the tool's own use cases)
    indexing: before.indexing, // never changed by an approval
  };
  const checklist = { ...input.checklist, category_id: t["category_id"] };
  const d = need(ctx.db);
  const cols = SNAPSHOT_FIELDS.filter((k) => k !== "indexing");
  await writeBatch(d, [
    {
      sql: `UPDATE tools SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE slug = ? AND updated_at = ?`,
      params: [...cols.map((k) => after[k]), ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    historyStep(ctx, t, "approve", before, after, checklist, draft),
    auditStep(
      ctx.actor,
      "tool.review_approve",
      "tool",
      slug,
      "Approved review draft (tool is reviewed; indexing unchanged)",
      ctx.now,
      { table: "tools", key: "slug", value: slug, stamp: "updated_at" },
    ),
    catalogVersionStep(ctx.now),
  ]);
  return { ok: true, pricing: choice };
}

export async function rejectToolDraft(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof draftDecisionSchema>,
) {
  await toolRow(ctx, slug);
  const d = need(ctx.db);
  await writeBatch(d, [
    {
      sql: "UPDATE tools SET review_draft = NULL, review_status = CASE WHEN review_status = 'reviewed' THEN 'reviewed' ELSE 'needs_manual' END, review_notes = 'draft rejected by an editor', updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(ctx.actor, "tool.review_reject", "tool", slug, "Rejected review draft", ctx.now, {
      table: "tools",
      key: "slug",
      value: slug,
      stamp: "updated_at",
    }),
  ]);
  return { ok: true };
}

/** The latest approval of a tool that has not been reverted. */
async function latestApproval(ctx: Ctx, toolId: string) {
  const d = need(ctx.db);
  return readSafe(() =>
    d
      .prepare(
        "SELECT * FROM tool_review_history WHERE tool_id = ? AND action = 'approve' AND reverted_at IS NULL ORDER BY id DESC LIMIT 1",
      )
      .bind(toolId)
      .first<Row>(),
  );
}

/** Approval history of a tool, newest first (for the admin). */
export async function reviewHistory(ctx: Ctx, slug: string) {
  const t = await toolRow(ctx, slug);
  const d = need(ctx.db);
  const rows = await readSafe(() =>
    d
      .prepare(
        "SELECT id, at, actor_email, action, checklist, reverted_at FROM tool_review_history WHERE tool_id = ? ORDER BY id DESC LIMIT 20",
      )
      .bind(t["id"])
      .all<Row>(),
  );
  return { items: rows.results.map((r) => ({ ...r, checklist: parseJson(r["checklist"]) })) };
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Reverts the latest approval: restores every field exactly as it was before it and forces noindex. Refused when the
 * tool was edited after the approval (its fields no longer hold what the approval wrote), so no later edit is lost.
 */
export async function revertApproval(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof draftDecisionSchema>,
) {
  const t = await toolRow(ctx, slug);
  const h = await latestApproval(ctx, String(t["id"]));
  if (!h) throw new HttpError(409, "nothing_to_revert", "This tool has no approval to revert.");
  const wrote = parseJson(h["after"]) as Snapshot;
  const restore = parseJson(h["before"]) as Snapshot;
  const current = snapshotOf(t);
  const changed = SNAPSHOT_FIELDS.filter((k) => k !== "indexing" && !same(current[k], wrote[k]));
  if (changed.length)
    throw new HttpError(
      409,
      "edited_since_approval",
      `The tool was edited after the approval (${changed.join(", ")}). Revert would overwrite those edits; change it in the editor instead.`,
    );
  const after: Snapshot = { ...restore, indexing: "noindex" };
  const d = need(ctx.db);
  await writeBatch(d, [
    {
      sql: `UPDATE tools SET ${SNAPSHOT_FIELDS.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE slug = ? AND updated_at = ?`,
      params: [...SNAPSHOT_FIELDS.map((k) => after[k]), ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    {
      sql: "UPDATE tool_review_history SET reverted_at = ? WHERE id = ? AND reverted_at IS NULL",
      params: [ctx.now, h["id"]],
      expectChanges: 1,
    },
    historyStep(ctx, t, "revert", current, after, null, null),
    auditStep(
      ctx.actor,
      "tool.review_revert",
      "tool",
      slug,
      `Reverted the approval of ${String(h["at"]).slice(0, 16)} (content restored, indexing off)`,
      ctx.now,
      { table: "tools", key: "slug", value: slug, stamp: "updated_at" },
    ),
    catalogVersionStep(ctx.now),
  ]);
  return { ok: true };
}

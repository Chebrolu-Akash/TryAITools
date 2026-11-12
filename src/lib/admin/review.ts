// Review drafts in the admin (approved plan D2/D4). Generate: fetch the official pages, ask Gemini (free tier), store the
// grounded draft (never public). Approve: copy the draft into the public fields and mark the tool reviewed (indexing is a
// separate, gated bulk step). Reject: keep the tool as it was and send it to manual review.
import * as z from "zod";
import { generateDraft, type ReviewDraft } from "@/lib/tools/review-draft";
import { auditStep, catalogVersionStep, HttpError, readSafe, writeBatch } from "./db";
import { need, parseJson, type Ctx, type Row } from "./repo";

export const draftDecisionSchema = z.object({ updated_at: z.string().min(10).max(40) }).strict();

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
  await writeBatch(d, [
    {
      sql: "UPDATE tools SET review_draft = ?, review_status = CASE WHEN review_status = 'reviewed' THEN 'reviewed' ELSE ? END, review_notes = ?, url_checked_at = ?, updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [
        draft ? JSON.stringify(draft) : null,
        status,
        notes,
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

/** Copies an approved draft into the public fields. Does NOT index the tool. */
export async function approveToolDraft(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof draftDecisionSchema>,
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
  const d = need(ctx.db);
  await writeBatch(d, [
    {
      sql: `UPDATE tools SET tagline = ?, overview = ?, features = ?, pros = ?, limits = ?,
              pricing_model = ?, pricing_note = ?, pricing_source = ?, pricing_checked_at = ?,
              seo_title = ?, seo_description = ?, review_sources = ?, review_status = 'reviewed', reviewed_at = ?,
              review_draft = NULL, review_notes = NULL, updated_at = ?
            WHERE slug = ? AND updated_at = ?`,
      params: [
        draft.tagline || null,
        draft.overview,
        JSON.stringify(draft.features),
        JSON.stringify(draft.pros),
        JSON.stringify(draft.limits),
        draft.pricing.model,
        draft.pricing.summary || null,
        draft.pricing.source_url,
        draft.generated_at.slice(0, 10), // checked on this date: verified, or recorded as unknown when model is null
        draft.seo_title || null,
        draft.seo_description || null,
        JSON.stringify(draft.sources.map((s) => ({ url: s.url, checked_at: s.checked_at }))),
        ctx.now,
        ctx.now,
        slug,
        input.updated_at,
      ],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      "tool.review_approve",
      "tool",
      slug,
      "Approved review draft (tool is reviewed; indexing unchanged)",
      ctx.now,
      {
        table: "tools",
        key: "slug",
        value: slug,
        stamp: "updated_at",
      },
    ),
    catalogVersionStep(ctx.now),
  ]);
  return { ok: true };
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

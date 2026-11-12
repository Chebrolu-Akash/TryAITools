// The review workflow for one tool: generate a grounded draft from the official pages (Gemini free tier), inspect every
// claim with the quote that supports it, then approve (the content goes live; indexing is unchanged) or reject.
import { useState } from "react";
import { api } from "./client";
import { Banner, btnGhost, btnPrimary, card, errorMessage } from "./ui";

type Draft = {
  tagline: string;
  overview: string;
  features: string[];
  pros: string[];
  limits: string[];
  pricing: { model: string | null; summary: string; source_url: string | null };
  seo_title: string;
  seo_description: string;
  evidence: { features: string[]; pros: string[]; limits: string[]; pricing: string };
  sources: { url: string; checked_at: string; kind: string }[];
  quality: {
    status: string;
    reasons: string[];
    identity: { matches: boolean; name_on_site: string; reason: string };
    dropped_ungrounded: number;
    pricing_verified: boolean;
  };
  model: string;
  generated_at: string;
};
export type ReviewTool = {
  slug: string;
  updated_at: string;
  review_status?: string | null;
  review_draft?: string | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
};

const parse = (v: unknown): Draft | null => {
  if (!v) return null;
  if (typeof v === "object") return v as Draft;
  try {
    return JSON.parse(String(v)) as Draft;
  } catch {
    return null;
  }
};

function Claims({ title, items, quotes }: { title: string; items: string[]; quotes: string[] }) {
  if (!items.length)
    return (
      <p className="text-sm text-muted-foreground">{title}: none verified on the official pages.</p>
    );
  return (
    <div>
      <h4 className="text-sm font-bold">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((t, i) => (
          <li key={i}>
            {t}
            <div className="text-xs text-muted-foreground">“{quotes[i]}”</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewDraftPanel({ tool, onChanged }: { tool: ReviewTool; onChanged: () => void }) {
  const [busy, setBusy] = useState<"" | "generate" | "approve" | "reject">("");
  const [err, setErr] = useState<unknown>(null);
  const draft = parse(tool.review_draft);
  const run = async (kind: "generate" | "approve" | "reject") => {
    setBusy(kind);
    setErr(null);
    try {
      const base = `tools/${encodeURIComponent(tool.slug)}/draft`;
      if (kind === "generate") await api.post(base, {});
      else await api.post(`${base}/${kind}`, { updated_at: tool.updated_at });
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className={`${card} space-y-4`} aria-labelledby="review-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="review-h" className="text-lg font-extrabold">
            Review
          </h3>
          <p className="text-sm text-muted-foreground">
            Status: <strong>{(tool.review_status ?? "unreviewed").replace("_", " ")}</strong>
            {tool.reviewed_at ? ` · reviewed ${tool.reviewed_at.slice(0, 10)}` : ""}
            {tool.review_notes ? ` · ${tool.review_notes}` : ""}
          </p>
        </div>
        <button
          type="button"
          className={btnGhost}
          onClick={() => run("generate")}
          disabled={!!busy}
        >
          {busy === "generate"
            ? "Reading the official pages…"
            : draft
              ? "Regenerate draft"
              : "Generate grounded draft"}
        </button>
      </div>
      {!!err && <Banner kind="error">{errorMessage(err)}</Banner>}
      {draft && (
        <div className="space-y-4 rounded-2xl border border-primary/10 p-4">
          <Banner kind={draft.quality.status === "draft_ready" ? "success" : "error"}>
            {draft.quality.status === "draft_ready"
              ? "Every claim below is backed by a quote from the official pages."
              : `Needs manual work: ${draft.quality.reasons.join("; ")}`}
            {draft.quality.dropped_ungrounded
              ? ` (${draft.quality.dropped_ungrounded} unsupported claim(s) were removed.)`
              : ""}
          </Banner>
          <div className="text-sm">
            <div>
              <strong>Tagline:</strong> {draft.tagline || "—"}
            </div>
            <p className="mt-2">{draft.overview}</p>
          </div>
          <Claims title="Features" items={draft.features} quotes={draft.evidence.features} />
          <Claims title="Advantages" items={draft.pros} quotes={draft.evidence.pros} />
          <Claims title="Limitations" items={draft.limits} quotes={draft.evidence.limits} />
          <div className="text-sm">
            <strong>Pricing:</strong>{" "}
            {draft.pricing.model ? (
              <>
                {draft.pricing.model} — {draft.pricing.summary}
                <div className="text-xs text-muted-foreground">“{draft.evidence.pricing}”</div>
              </>
            ) : (
              "not verified on the official pages (will be recorded as unknown)"
            )}
          </div>
          <div className="text-sm">
            <div>
              <strong>SEO title:</strong> {draft.seo_title}{" "}
              <span className="text-xs text-muted-foreground">({draft.seo_title.length})</span>
            </div>
            <div>
              <strong>Meta description:</strong> {draft.seo_description}{" "}
              <span className="text-xs text-muted-foreground">
                ({draft.seo_description.length})
              </span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Sources:{" "}
            {draft.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mr-2 underline"
              >
                {s.kind}
              </a>
            ))}
            · {draft.model} · {draft.generated_at.slice(0, 16).replace("T", " ")} UTC · identity:{" "}
            {draft.quality.identity.matches ? "confirmed" : "not confirmed"}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => run("approve")}
              disabled={!!busy || draft.quality.status !== "draft_ready"}
            >
              {busy === "approve" ? "Approving…" : "Approve (publish this content)"}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => run("reject")}
              disabled={!!busy}
            >
              Reject
            </button>
            <span className="self-center text-xs text-muted-foreground">
              Approving does not change indexing.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

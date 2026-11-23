// The review workflow for one tool (approved G1–G10 workflow):
//   1. generate a grounded draft from the official pages (Gemini free tier) — never public;
//   2. edit every claim (its official-page quote stays beside it; a claim can be reworded or removed, never added);
//   3. tick the checklist and approve: the content becomes the tool's own, the previous values are kept for revert;
//      approval NEVER changes indexing (that is the separate, gated step in the Indexing panel);
//   or reject the draft, or revert the last approval.
import { useEffect, useState } from "react";
import { api } from "./client";
import { Banner, btnDanger, btnGhost, btnPrimary, card, errorMessage, inputCls } from "./ui";

type Draft = {
  tagline: string;
  overview: string;
  features: string[];
  best_for?: string[];
  pros: string[];
  limits: string[];
  pricing: { model: string | null; summary: string; source_url: string | null };
  seo_title: string;
  seo_description: string;
  evidence: {
    features: string[];
    best_for?: string[];
    pros: string[];
    limits: string[];
    pricing: string;
  };
  sources: { url: string; checked_at: string; kind: string; text?: string }[];
  quality: {
    status: string;
    reasons: string[];
    identity: { matches: boolean; name_on_site: string; reason: string };
    dropped_ungrounded: number;
    signals?: string[];
    fixes?: string[];
    notes?: string[];
    pricing_verified: boolean;
  };
  model: string;
  generated_at: string;
};
export type ReviewTool = {
  slug: string;
  updated_at: string;
  category_id?: string | null;
  category_name?: string | null;
  pricing_model?: string | null;
  pricing_source?: string | null;
  pricing_checked_at?: string | null;
  review_status?: string | null;
  review_draft?: string | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
};
type Claim = { text: string; ref: number; keep: boolean };
type History = {
  id: number;
  at: string;
  actor_email: string;
  action: string;
  reverted_at: string | null;
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
const claims = (xs: string[] | undefined): Claim[] =>
  (xs ?? []).map((text, ref) => ({ text, ref, keep: true }));

function ClaimEditor({
  title,
  items,
  quotes,
  onChange,
  disabled,
}: {
  title: string;
  items: Claim[];
  quotes: string[];
  onChange: (c: Claim[]) => void;
  disabled: boolean;
}) {
  if (!items.length)
    return (
      <p className="text-sm text-muted-foreground">{title}: none verified on the official pages.</p>
    );
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-bold">{title}</legend>
      {items.map((c, i) => (
        <div key={c.ref} className="rounded-xl border border-primary/10 p-2">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              aria-label={`Keep ${title.toLowerCase()} ${i + 1}`}
              checked={c.keep}
              disabled={disabled}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))
              }
              className="mt-2"
            />
            <input
              className={inputCls}
              aria-label={`${title} ${i + 1}`}
              value={c.text}
              disabled={disabled || !c.keep}
              maxLength={200}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
            />
          </div>
          <div className="mt-1 pl-6 text-xs text-muted-foreground">
            Official page: “{quotes[c.ref]}”
          </div>
        </div>
      ))}
    </fieldset>
  );
}

const CHECKS = [
  ["claims_checked", "Every kept claim is supported by its quote"],
  ["own_wording", "The wording is ours, not the vendor's marketing copy"],
  ["pricing_confirmed", "Pricing confirmed (or correctly left unknown)"],
  ["category_confirmed", "Category is right for this tool"],
] as const;
type CheckKey = (typeof CHECKS)[number][0];

export function ReviewDraftPanel({ tool, onChanged }: { tool: ReviewTool; onChanged: () => void }) {
  const [busy, setBusy] = useState<"" | "generate" | "approve" | "reject" | "revert">("");
  const [err, setErr] = useState<unknown>(null);
  const [history, setHistory] = useState<History[]>([]);
  const draft = parse(tool.review_draft);
  const [tagline, setTagline] = useState("");
  const [overview, setOverview] = useState("");
  const [features, setFeatures] = useState<Claim[]>([]);
  const [bestFor, setBestFor] = useState<Claim[]>([]);
  const [pros, setPros] = useState<Claim[]>([]);
  const [limits, setLimits] = useState<Claim[]>([]);
  const [pricing, setPricing] = useState<"draft" | "kept" | "unknown">("unknown");
  const [summary, setSummary] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({
    claims_checked: false,
    own_wording: false,
    pricing_confirmed: false,
    category_confirmed: false,
  });
  // load the draft into the editable form whenever a (new) draft arrives
  useEffect(() => {
    if (!draft) return;
    setTagline(draft.tagline);
    setOverview(draft.overview);
    setFeatures(claims(draft.features));
    setBestFor(claims(draft.best_for));
    setPros(claims(draft.pros));
    setLimits(claims(draft.limits));
    setPricing(draft.pricing.model ? "draft" : tool.pricing_model ? "kept" : "unknown");
    setSummary(draft.pricing.summary);
    setSeoTitle(draft.seo_title);
    setSeoDesc(draft.seo_description);
    setChecks({
      claims_checked: false,
      own_wording: false,
      pricing_confirmed: false,
      category_confirmed: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the stored draft changes
  }, [tool.review_draft]);
  useEffect(() => {
    api
      .get<{ items: History[] }>(`tools/${encodeURIComponent(tool.slug)}/review-history`)
      .then((r) => setHistory(Array.isArray(r?.items) ? r.items : []))
      .catch(() => setHistory([]));
  }, [tool.slug, tool.updated_at]);

  const base = `tools/${encodeURIComponent(tool.slug)}/draft`;
  const run = async (kind: "generate" | "approve" | "reject" | "revert") => {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "generate") await api.post(base, {});
      else if (kind === "approve") {
        const keep = (xs: Claim[]) =>
          xs.filter((x) => x.keep).map(({ text, ref }) => ({ text, ref }));
        await api.post(`${base}/approve`, {
          updated_at: tool.updated_at,
          content: {
            tagline,
            overview,
            features: keep(features),
            best_for: keep(bestFor),
            pros: keep(pros),
            limits: keep(limits),
            pricing: { choice: pricing, summary: pricing === "draft" ? summary : "" },
            seo_title: seoTitle,
            seo_description: seoDesc,
          },
          checklist: checks,
        });
      } else await api.post(`${base}/${kind}`, { updated_at: tool.updated_at });
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy("");
    }
  };
  const ready = draft?.quality.status === "draft_ready";
  const outdated =
    !!draft && (!Array.isArray(draft.best_for) || !draft.sources.some((s) => s.text));
  const canApprove =
    ready && !outdated && checks.claims_checked && checks.own_wording && checks.pricing_confirmed;
  const lastApproval = history.find((h) => h.action === "approve" && !h.reverted_at);
  const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

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
        <div className="flex flex-wrap gap-2">
          {lastApproval && (
            <button
              type="button"
              className={btnDanger}
              onClick={() => run("revert")}
              disabled={!!busy}
              title="Restores the content from before the approval and switches indexing off"
            >
              {busy === "revert" ? "Reverting…" : "Revert approval"}
            </button>
          )}
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
      </div>
      {!!err && <Banner kind="error">{errorMessage(err)}</Banner>}
      {lastApproval && (
        <p className="text-xs text-muted-foreground">
          Approved {lastApproval.at.slice(0, 16).replace("T", " ")} UTC by{" "}
          {lastApproval.actor_email}. The previous content is kept: “Revert approval” restores it
          exactly.
        </p>
      )}
      {draft && (
        <div className="space-y-4 rounded-2xl border border-primary/10 p-4">
          <Banner kind={ready && !outdated ? "success" : "error"}>
            {outdated
              ? "This draft was made before the current checks (no stored source text or use cases). Regenerate it."
              : ready
                ? "Every claim below is backed by a quote from the official pages. Edit the wording, untick anything you do not want, then approve."
                : `Needs manual research: ${draft.quality.reasons.join("; ")}`}
            {draft.quality.dropped_ungrounded
              ? ` (${draft.quality.dropped_ungrounded} unsupported claim(s) were removed.)`
              : ""}
          </Banner>
          {ready && !!draft.quality.fixes?.length && (
            <Banner kind="error">Fix before approving: {draft.quality.fixes.join("; ")}.</Banner>
          )}
          {!!draft.quality.notes?.length && (
            <p className="text-xs text-muted-foreground">
              Removed automatically: {draft.quality.notes.join("; ")}.
            </p>
          )}
          <label className="block text-sm">
            <span className="font-bold">Tagline</span>{" "}
            <span className="text-xs text-muted-foreground">({words(tagline)} words, 3–12)</span>
            <input
              className={inputCls}
              value={tagline}
              maxLength={160}
              onChange={(e) => setTagline(e.target.value)}
              disabled={!ready}
            />
          </label>
          <label className="block text-sm">
            <span className="font-bold">Overview</span>{" "}
            <span className="text-xs text-muted-foreground">({words(overview)} words, 45–110)</span>
            <textarea
              className={`${inputCls} min-h-32`}
              value={overview}
              maxLength={1200}
              onChange={(e) => setOverview(e.target.value)}
              disabled={!ready}
            />
          </label>
          <ClaimEditor
            title="Features"
            items={features}
            quotes={draft.evidence.features}
            onChange={setFeatures}
            disabled={!ready}
          />
          <ClaimEditor
            title="Best for (use cases)"
            items={bestFor}
            quotes={draft.evidence.best_for ?? []}
            onChange={setBestFor}
            disabled={!ready}
          />
          <ClaimEditor
            title="Advantages"
            items={pros}
            quotes={draft.evidence.pros}
            onChange={setPros}
            disabled={!ready}
          />
          <ClaimEditor
            title="Limitations"
            items={limits}
            quotes={draft.evidence.limits}
            onChange={setLimits}
            disabled={!ready}
          />
          <fieldset className="space-y-2 text-sm">
            <legend className="font-bold">Pricing</legend>
            {draft.pricing.model && (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="pricing"
                  checked={pricing === "draft"}
                  onChange={() => setPricing("draft")}
                  disabled={!ready}
                  className="mt-1"
                />
                <span className="w-full">
                  Draft: <strong>{draft.pricing.model}</strong>
                  <input
                    className={`${inputCls} mt-1`}
                    aria-label="Pricing summary"
                    value={summary}
                    maxLength={300}
                    onChange={(e) => setSummary(e.target.value)}
                    disabled={!ready || pricing !== "draft"}
                  />
                  <span className="block text-xs text-muted-foreground">
                    Official page: “{draft.evidence.pricing}”. Amounts and plan names must appear in
                    this quote.
                  </span>
                </span>
              </label>
            )}
            {tool.pricing_model && (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="pricing"
                  checked={pricing === "kept"}
                  onChange={() => setPricing("kept")}
                  disabled={!ready}
                  className="mt-1"
                />
                <span>
                  Keep the current verified pricing: <strong>{tool.pricing_model}</strong>
                  {tool.pricing_checked_at ? ` (checked ${tool.pricing_checked_at})` : ""}
                </span>
              </label>
            )}
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="pricing"
                checked={pricing === "unknown"}
                onChange={() => setPricing("unknown")}
                disabled={!ready}
                className="mt-1"
              />
              <span>
                Unknown (recorded with today's check date)
                {tool.pricing_model ? " — this replaces the verified pricing above" : ""}
              </span>
            </label>
          </fieldset>
          <label className="block text-sm">
            <span className="font-bold">SEO title</span>{" "}
            <span className="text-xs text-muted-foreground">({seoTitle.length}/58)</span>
            <input
              className={inputCls}
              value={seoTitle}
              maxLength={70}
              onChange={(e) => setSeoTitle(e.target.value)}
              disabled={!ready}
            />
          </label>
          <label className="block text-sm">
            <span className="font-bold">Meta description</span>{" "}
            <span className="text-xs text-muted-foreground">({seoDesc.length}, 120–155)</span>
            <textarea
              className={inputCls}
              value={seoDesc}
              maxLength={170}
              onChange={(e) => setSeoDesc(e.target.value)}
              disabled={!ready}
            />
          </label>
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
            {draft.quality.signals?.length ? ` · signals: ${draft.quality.signals.join("; ")}` : ""}
          </div>
          {ready && !outdated && (
            <fieldset className="space-y-1 rounded-xl bg-secondary/40 p-3 text-sm">
              <legend className="font-bold">Approval checklist</legend>
              {CHECKS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checks[k]}
                    onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })}
                  />
                  {label}
                  {k === "category_confirmed" && tool.category_name
                    ? ` (${tool.category_name})`
                    : ""}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => run("approve")}
              disabled={!!busy || !canApprove}
            >
              {busy === "approve" ? "Approving…" : "Approve (content goes live, still noindex)"}
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
              Approving never changes indexing. Indexing is a separate step below, allowed only when
              G1–G10 pass.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

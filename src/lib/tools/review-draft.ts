// SERVER/SCRIPT ONLY. Grounded review drafts for tool listings (approved plan D2/D4): the tool's official homepage and
// pricing page are fetched, Google Gemini (free tier, no paid fallback) writes a draft from those pages ONLY, and every
// feature, advantage, limitation and pricing claim must quote the page verbatim. Code then checks each quote really is
// in the fetched text; anything unsupported is dropped. Pricing without evidence is recorded as unknown, never guessed.
// A draft is never public: an editor approves it (it then becomes "reviewed"); indexing is a separate, gated step.
import { z } from "zod";
import { robotsAllows } from "@/lib/news/robots";
import { DEFAULT_NEWS_MODEL } from "@/lib/news/summarize";
import { unsupportedPricingClaims } from "./pricing-claims";

export const REVIEW_USER_AGENT = "TryAITools-ReviewBot/1.0 (+https://tryaitools.io/how-we-review)";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// heavy marketing sites inline 150 KB+ of CSS before any body text
const MAX_HTML_BYTES = 1_500_000;
// navigation menus on large sites can fill 7,000 characters before the product copy starts
const MAX_TEXT = { home: 12000, pricing: 6000 };
export const PRICING_MODELS = ["free", "freemium", "free_trial", "paid"] as const;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type Source = {
  kind: "home" | "pricing";
  url: string;
  checked_at: string;
  title: string;
  text: string;
};

// ------------------------------------------------------------------------------------------------ fetching
/** Visible text of an HTML page: scripts/styles/svg/nav chrome removed, tags stripped, entities decoded, whitespace collapsed. */
export function pageText(html: string): string {
  return (
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      // a page cut off at the byte cap can end inside one of those blocks: drop the unclosed tail
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*$/i, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|tr|td|th)>/gi, "\n")
      // quote-aware: utility-class attributes such as class="[&>div]:p-2" contain ">"
      .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;|&#x27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}
const titleOf = (html: string) =>
  (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
const metaDesc = (html: string) =>
  (/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i.exec(html)?.[1] ?? "")
    .trim()
    .slice(0, 400);

async function getHtml(
  url: string,
  f: Fetch,
): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; error: string }> {
  try {
    const r = await f(url, {
      // English listing: ask for English pages (some sites geo-redirect, e.g. to /fr/)
      headers: {
        "user-agent": REVIEW_USER_AGENT,
        accept: "text/html",
        "accept-language": "en-US,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    if (!(r.headers.get("content-type") ?? "").includes("html"))
      return { ok: false, error: "not an HTML page" };
    const reader = r.body?.getReader();
    if (!reader) return { ok: false, error: "empty body" };
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      buf.set(c.subarray(0, Math.min(c.length, got - o)), o);
      o += c.length;
    }
    return { ok: true, html: new TextDecoder().decode(buf), finalUrl: r.url || url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name : "network error" };
  }
}

async function allowedByRobots(url: string, f: Fetch): Promise<boolean> {
  try {
    const u = new URL(url);
    const r = await f(`${u.origin}/robots.txt`, {
      headers: { "user-agent": REVIEW_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return true; // no robots.txt: allowed
    return robotsAllows((await r.text()).slice(0, 100_000), url);
  } catch {
    return true;
  }
}

/** Finds the pricing page: a same-site link whose path or text says pricing/plans, else /pricing. */
export function pricingUrl(html: string, pageUrl: string): string {
  const origin = new URL(pageUrl).origin;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const href = m[1] ?? "";
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
    try {
      const u = new URL(href, pageUrl);
      if (u.origin !== origin) continue;
      if (
        /\/(pricing|plans|price)(\/|$|\.)/i.test(u.pathname) ||
        /\bpricing\b|\bplans\b/.test(label)
      )
        return `${u.origin}${u.pathname}`;
    } catch {
      // ignore bad hrefs
    }
  }
  return `${origin}/pricing`;
}

export type Collected =
  | { ok: true; sources: Source[]; finalUrl: string; homeTitle: string }
  | { ok: false; reason: string };

/** Fetches the official homepage and (when it exists) the pricing page. */
export async function collectSources(
  url: string,
  f: Fetch = fetch,
  now = new Date().toISOString(),
): Promise<Collected> {
  if (!(await allowedByRobots(url, f)))
    return { ok: false, reason: "robots.txt disallows automated access" };
  const home = await getHtml(url, f);
  if (!home.ok) return { ok: false, reason: `official page unavailable (${home.error})` };
  const homeText = `${metaDesc(home.html)}\n${pageText(home.html)}`.slice(0, MAX_TEXT.home);
  const sources: Source[] = [
    {
      kind: "home",
      url: home.finalUrl,
      checked_at: now,
      title: titleOf(home.html),
      text: homeText,
    },
  ];
  const pUrl = pricingUrl(home.html, home.finalUrl);
  if (pUrl !== home.finalUrl && (await allowedByRobots(pUrl, f))) {
    const p = await getHtml(pUrl, f);
    if (p.ok && new URL(p.finalUrl).origin === new URL(home.finalUrl).origin) {
      const text = pageText(p.html).slice(0, MAX_TEXT.pricing);
      if (text.split(/\s+/).length >= 30)
        sources.push({
          kind: "pricing",
          url: p.finalUrl,
          checked_at: now,
          title: titleOf(p.html),
          text,
        });
    }
  }
  return { ok: true, sources, finalUrl: home.finalUrl, homeTitle: sources[0]!.title };
}

// ------------------------------------------------------------------------------------------------ the model
const SYSTEM = `You write factual directory entries for TryAITools, a directory of AI tools.
You receive ONE tool's listing (name, website, category) and the text of its OFFICIAL web pages. Use ONLY that text.
Never use outside knowledge, never guess, never invent features, prices, ratings, reviews, customers, statistics or claims.

Rules:
- identity: say whether the pages are really the official site of the named product (matches = false if the pages are
  for a different product, a parked domain, a login wall, an error page, or there is too little text to tell).
- Every feature, advantage, limitation and the pricing must carry "evidence": a SHORT VERBATIM quote (3-25 words) copied
  exactly from the page text that supports it. If you cannot quote support, leave the item out.
- features: up to 6 concrete capabilities, each one sentence (max 18 words), plain language, no marketing superlatives.
- advantages: up to 4 practical benefits the pages state or directly show (e.g. a free plan, integrations, platforms).
- use_cases: 2-4 short items (max 12 words each) saying who the tool is for or what it is used for, as the pages state
  it (e.g. "Marketing teams planning social media posts"). Each needs its own evidence quote.
- limitations: up to 3 limits the pages state or directly show (e.g. no free plan, usage caps, waitlist, platform limits,
  enterprise-only features). If the pages show none, return an empty list. Do not invent drawbacks.
- pricing.model: free | freemium | free_trial | paid | unknown. Use unknown unless the pages clearly show it.
  pricing.summary: one short factual sentence, or "" when unknown. Never state a price that is not on the page.
- tagline: 3-12 words. overview: 45-110 words, original wording (do not copy sentences), neutral and factual.
- seo_title: "<Name>: <what it does in 3-6 words>", at most 58 characters, no brand of ours.
- seo_description: 120-155 characters, factual, mentions the main use and pricing model only if known.
- insufficient = true when the text is too thin to write an honest entry; then other fields may be empty.`;

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidence"],
  properties: { text: { type: "string" }, evidence: { type: "string" } },
};
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "insufficient",
    "identity",
    "tagline",
    "overview",
    "features",
    "use_cases",
    "advantages",
    "limitations",
    "pricing",
    "seo_title",
    "seo_description",
  ],
  properties: {
    insufficient: { type: "boolean" },
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["matches", "name_on_site", "reason"],
      properties: {
        matches: { type: "boolean" },
        name_on_site: { type: "string" },
        reason: { type: "string" },
      },
    },
    tagline: { type: "string" },
    overview: { type: "string" },
    features: { type: "array", items: ITEM },
    use_cases: { type: "array", items: ITEM },
    advantages: { type: "array", items: ITEM },
    limitations: { type: "array", items: ITEM },
    pricing: {
      type: "object",
      additionalProperties: false,
      required: ["model", "summary", "evidence"],
      properties: {
        model: { type: "string", enum: [...PRICING_MODELS, "unknown"] },
        summary: { type: "string" },
        evidence: { type: "string" },
      },
    },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
  },
};
const item = z.object({ text: z.string(), evidence: z.string() });
const answerSchema = z.object({
  insufficient: z.boolean(),
  identity: z.object({ matches: z.boolean(), name_on_site: z.string(), reason: z.string() }),
  tagline: z.string(),
  overview: z.string(),
  features: z.array(item),
  use_cases: z.array(item).default([]),
  advantages: z.array(item),
  limitations: z.array(item),
  pricing: z.object({
    model: z.enum([...PRICING_MODELS, "unknown"]),
    summary: z.string(),
    evidence: z.string(),
  }),
  seo_title: z.string(),
  seo_description: z.string(),
});
type Answer = z.infer<typeof answerSchema>;

// ------------------------------------------------------------------------------------------------ grounding & quality
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9$€£₹%.,'+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** True when the quote (3+ words) appears in the source text, ignoring case, punctuation spacing and quote styles. */
export function grounded(evidence: string, sourceText: string): boolean {
  return groundedIn(evidence, norm(sourceText));
}
/** Same check against text that is already normalised (normalise the page once, check many quotes). */
const groundedIn = (evidence: string, normalisedSource: string) => {
  const e = norm(evidence);
  return e.split(" ").length >= 3 && normalisedSource.includes(e);
};
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const sentence = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export type ReviewDraft = {
  tagline: string;
  overview: string;
  features: string[];
  /** 2-4 grounded use cases ("best for"). */
  best_for: string[];
  pros: string[];
  limits: string[];
  pricing: {
    model: (typeof PRICING_MODELS)[number] | null;
    summary: string;
    source_url: string | null;
  };
  seo_title: string;
  seo_description: string;
  evidence: {
    features: string[];
    best_for: string[];
    pros: string[];
    limits: string[];
    pricing: string;
  };
  /** The official pages, with the text the quotes were checked against (kept so approval can re-verify every quote). */
  sources: { url: string; checked_at: string; kind: string; text?: string }[];
  quality: {
    status: "draft_ready" | "needs_manual";
    /** Why the draft needs manual research (the product, its site or too little verified). */
    reasons: string[];
    /** What the editor must fix before approving (lengths); approval refuses until they are fixed. */
    fixes?: string[];
    /** What the pipeline removed or adjusted automatically (e.g. an unsupported pricing summary). */
    notes?: string[];
    identity: { matches: boolean; name_on_site: string; reason: string };
    dropped_ungrounded: number;
    /** Parked domain, shut-down or rebrand wording, or a redirect to another site. */
    signals: string[];
    features: number;
    pros: number;
    limits: number;
    pricing_verified: boolean;
    overview_words: number;
  };
  model: string;
  generated_at: string;
};

const PARKED =
  /(parking-lander|domain (is )?for sale|buy this domain|this domain (may be|is) for sale|hugedomains|afternic)/i;
const CHANGED =
  /(shutting down|we('re| are) shutting|has shut down|has been discontinued|is (being )?discontinued|no longer (available|supported|operating|accepting)|sunsett?ing|has been sunset|end of life|ceased operations|has been acquired|we('ve| have) been acquired|is now part of|has joined forces|rebranded (to|as))/i;
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
/** Signs the listing may be outdated: a parked domain, shut-down/acquisition/rebrand wording, or a move to another site. */
export function pageSignals(sources: Source[], listedUrl?: string, finalUrl?: string): string[] {
  const text = sources.map((s) => s.text).join("\n");
  const out: string[] = [];
  if (PARKED.test(text) || /\/lander\b/.test(finalUrl ?? "")) out.push("domain appears parked");
  const m = CHANGED.exec(text);
  if (m) out.push(`page says "${m[0]}"`);
  if (listedUrl && finalUrl && hostOf(listedUrl) && hostOf(finalUrl) !== hostOf(listedUrl))
    out.push(`redirects to ${hostOf(finalUrl)}`);
  return out;
}

/** Turns the model's answer into a draft, keeping only grounded items, and assesses it. Pure. */
export function buildDraft(
  a: Answer,
  sources: Source[],
  tool: { name: string; url?: string },
  model: string,
  now: string,
  finalUrl?: string,
): ReviewDraft {
  const all = norm(sources.map((s) => s.text).join("\n"));
  const pricingSrc = sources.find((s) => s.kind === "pricing") ?? sources[0]!;
  let dropped = 0;
  const keep = (xs: { text: string; evidence: string }[], max: number, len: number) => {
    const out: { text: string; evidence: string }[] = [];
    for (const x of xs) {
      if (out.length >= max) break;
      if (x.text.trim() && groundedIn(x.evidence, all))
        out.push({ text: sentence(x.text, len), evidence: sentence(x.evidence, 220) });
      else dropped++;
    }
    return out;
  };
  const features = keep(a.features, 6, 160);
  const useCases = keep(a.use_cases ?? [], 4, 120);
  const pros = keep(a.advantages, 4, 160);
  const limits = keep(a.limitations, 3, 160);
  const pricingOk = a.pricing.model !== "unknown" && groundedIn(a.pricing.evidence, all);
  if (a.pricing.model !== "unknown" && !pricingOk) dropped++;
  const overview = sentence(a.overview, 900);
  const reasons: string[] = [];
  if (a.insufficient) reasons.push("the model found the official pages too thin");
  if (!a.identity.matches)
    reasons.push(`identity not confirmed: ${sentence(a.identity.reason, 160)}`);
  // Lengths are the editor's to fix (approval refuses until they are within the limits); an empty text is not fixable.
  const fixes: string[] = [];
  const notes: string[] = [];
  const ow = words(overview);
  if (ow < 20) reasons.push(`overview has ${ow} words (needs 45-110)`);
  else if (ow < 45 || ow > 110) fixes.push(`overview has ${ow} words (needs 45-110)`);
  const tw = words(a.tagline);
  if (tw === 0) reasons.push("no tagline");
  else if (tw < 3 || tw > 12) fixes.push(`tagline has ${tw} words (needs 3-12)`);
  if (features.length < 3)
    reasons.push(`only ${features.length} feature(s) could be verified (needs 3)`);
  if (useCases.length < 2)
    reasons.push(`only ${useCases.length} use case(s) could be verified (needs 2)`);
  // G5: a summary stating amounts or plan names its quote does not contain is removed (never published); the model,
  // which the quote does support, is kept.
  let summary = pricingOk ? sentence(a.pricing.summary, 300) : "";
  const unsupported = pricingOk ? unsupportedPricingClaims(summary, a.pricing.evidence) : [];
  if (unsupported.length) {
    notes.push(
      `pricing summary removed: it stated ${unsupported.join(", ")}, which its quote does not contain`,
    );
    summary = "";
  }
  const signals = pageSignals(sources, tool.url, finalUrl);
  if (signals.length) reasons.push(`check the product: ${signals.join("; ")}`);
  const title = sentence(a.seo_title, 70);
  const desc = sentence(a.seo_description, 170);
  if (
    !title.toLowerCase().includes(
      tool.name
        .toLowerCase()
        .replace(/\s*\(.+\)$/, "")
        .split(" ")[0]!,
    )
  )
    fixes.push("SEO title does not name the tool");
  return {
    tagline: sentence(a.tagline, 120),
    overview,
    features: features.map((x) => x.text),
    best_for: useCases.map((x) => x.text),
    pros: pros.map((x) => x.text),
    limits: limits.map((x) => x.text),
    pricing: {
      model: pricingOk ? (a.pricing.model as ReviewDraft["pricing"]["model"]) : null,
      summary,
      source_url: pricingOk ? pricingSrc.url : null,
    },
    seo_title: title,
    seo_description: desc,
    evidence: {
      features: features.map((x) => x.evidence),
      best_for: useCases.map((x) => x.evidence),
      pros: pros.map((x) => x.evidence),
      limits: limits.map((x) => x.evidence),
      pricing: pricingOk ? sentence(a.pricing.evidence, 220) : "",
    },
    sources: sources.map((s) => ({
      url: s.url,
      checked_at: s.checked_at,
      kind: s.kind,
      text: s.text,
    })),
    quality: {
      status: reasons.length ? "needs_manual" : "draft_ready",
      reasons,
      fixes,
      notes,
      identity: {
        matches: a.identity.matches,
        name_on_site: sentence(a.identity.name_on_site, 80),
        reason: sentence(a.identity.reason, 160),
      },
      dropped_ungrounded: dropped,
      signals,
      features: features.length,
      pros: pros.length,
      limits: limits.length,
      pricing_verified: pricingOk,
      overview_words: words(overview),
    },
    model,
    generated_at: now,
  };
}

export type DraftResult =
  | { ok: true; draft: ReviewDraft; finalUrl?: string }
  | { ok: false; reason: string; deferred: boolean; stopRun?: boolean; sources?: Source[] };

export type DraftTool = { name: string; url: string; category: string; subcategory: string | null };

/** Fetches the official pages, asks Gemini (free tier) and returns a grounded draft or the reason it could not. */
export async function generateDraft(
  tool: DraftTool,
  opts: { apiKey: string; model?: string; fetch?: Fetch; now?: string },
): Promise<DraftResult> {
  const f = opts.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init));
  const now = opts.now ?? new Date().toISOString();
  const model = (
    opts.model && /^gemini-[a-z0-9.-]+$/.test(opts.model) ? opts.model : DEFAULT_NEWS_MODEL
  ).replace(/^models\//, "");
  const c = await collectSources(tool.url, f, now);
  if (!c.ok) return { ok: false, reason: c.reason, deferred: false };
  const prompt = [
    "<listing>",
    `<name>${tool.name}</name>`,
    `<website>${tool.url}</website>`,
    `<category>${tool.category}${tool.subcategory ? ` / ${tool.subcategory}` : ""}</category>`,
    "</listing>",
    ...c.sources.map(
      (s) =>
        `<page kind="${s.kind}" url="${s.url}">\n<title>${s.title}</title>\n${s.text}\n</page>`,
    ),
  ].join("\n");
  let res: Response;
  try {
    res = await f(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: OUTPUT_SCHEMA,
          maxOutputTokens: 8192,
          ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return {
      ok: false,
      reason: `Gemini unreachable (${e instanceof Error ? e.name : "network"})`,
      deferred: true,
    };
  }
  if (!res.ok) {
    let msg = "";
    try {
      msg = JSON.stringify(((await res.json()) as { error?: unknown }).error ?? "").slice(0, 200);
    } catch {
      // not JSON
    }
    // 429: free quota used up -> stop and leave the tool as it is (no paid fallback, ever)
    if (res.status === 429)
      return {
        ok: false,
        reason: `Gemini free-tier limit reached (429)`,
        deferred: true,
        stopRun: true,
      };
    if ([400, 401, 403, 404].includes(res.status))
      return {
        ok: false,
        reason: `Gemini API ${res.status} ${msg}`,
        deferred: true,
        stopRun: true,
      };
    return { ok: false, reason: `Gemini API ${res.status}`, deferred: true };
  }
  const body = (await res.json()) as {
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
    promptFeedback?: { blockReason?: string };
  };
  if (body.promptFeedback?.blockReason)
    return { ok: false, reason: `blocked (${body.promptFeedback.blockReason})`, deferred: false };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  let a: Answer;
  try {
    const r = answerSchema.safeParse(JSON.parse(text));
    if (!r.success) throw new Error("schema");
    a = r.data;
  } catch {
    return { ok: false, reason: "the model's answer did not match the schema", deferred: true };
  }
  return {
    ok: true,
    draft: buildDraft(a, c.sources, tool, model, now, c.finalUrl),
    finalUrl: c.finalUrl,
  };
}

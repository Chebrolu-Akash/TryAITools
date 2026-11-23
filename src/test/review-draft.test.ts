// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON in tests */
// Grounded review drafts: only claims quoted from the official pages survive, pricing without evidence stays unknown, a
// wrong site goes to manual review, the free-quota limit changes nothing, and approving never indexes a tool.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi } from "@/lib/admin/api";
import type { JwksProvider } from "@/lib/admin/jwt";
import { buildDraft, grounded, pageText, pricingUrl, type Source } from "@/lib/tools/review-draft";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

const HOME = `<html><head><title>Acme Writer — AI writing</title><meta name="description" content="Acme Writer drafts blog posts with AI."></head>
<body><nav><a href="/pricing">Pricing</a></nav><script>var x=1</script>
<h1>Acme Writer</h1><p>Generate blog posts in seconds with our AI writer.</p>
<p>Rewrite paragraphs in 25 languages.</p><p>Integrates with WordPress and Google Docs.</p>
<p>Start free, no credit card required.</p>
<p>Built for marketing teams and freelance writers.</p><p>Used by students drafting essays and reports.</p>
<p>Plan content calendars for every channel.</p><p>Export finished drafts as Markdown or HTML.</p>
<p>Collaborate with comments and version history.</p></body></html>`;
const PRICING = `<html><head><title>Pricing</title></head><body><h1>Plans</h1>
<p>Free plan: 2,000 words per month.</p><p>Pro plan: $20 per month, unlimited words.</p>
<p>Enterprise: contact sales for single sign-on.</p><p>All plans include the Chrome extension and team sharing features for writers.</p></body></html>`;

const answer = (o: Record<string, unknown> = {}) => ({
  insufficient: false,
  identity: { matches: true, name_on_site: "Acme Writer", reason: "official site" },
  tagline: "AI writer for blog posts and rewrites",
  overview:
    "Acme Writer is an AI writing tool that drafts blog posts and rewrites paragraphs. It works in many languages and connects to the editors people already use, such as WordPress and Google Docs, so drafts can move straight into publishing workflows without copying text between tools.",
  features: [
    { text: "Generates blog posts with AI.", evidence: "Generate blog posts in seconds" },
    {
      text: "Rewrites paragraphs in 25 languages.",
      evidence: "Rewrite paragraphs in 25 languages",
    },
    {
      text: "Integrates with WordPress and Google Docs.",
      evidence: "Integrates with WordPress and Google Docs",
    },
    {
      text: "Has a built-in plagiarism checker.",
      evidence: "built-in plagiarism checker for every plan",
    }, // NOT on the pages
  ],
  use_cases: [
    {
      text: "Marketing teams and freelance writers",
      evidence: "Built for marketing teams and freelance writers",
    },
    {
      text: "Students drafting essays and reports",
      evidence: "Used by students drafting essays and reports",
    },
  ],
  advantages: [{ text: "Free plan available.", evidence: "Free plan: 2,000 words per month" }],
  limitations: [
    {
      text: "The free plan is capped at 2,000 words a month.",
      evidence: "Free plan: 2,000 words per month",
    },
  ],
  pricing: {
    model: "freemium",
    summary: "Pro plan at $20 per month with unlimited words.",
    evidence: "Pro plan: $20 per month, unlimited words",
  },
  seo_title: "Acme Writer: AI blog post writer",
  seo_description:
    "Acme Writer drafts blog posts and rewrites paragraphs in 25 languages, with WordPress and Google Docs integrations. Freemium: free plan plus Pro.",
  ...o,
});
const CHECKS = {
  claims_checked: true,
  own_wording: true,
  pricing_confirmed: true,
  category_confirmed: true,
};
const sources = (): Source[] => [
  {
    kind: "home",
    url: "https://acme.example.com/",
    checked_at: "2026-11-08T00:00:00Z",
    title: "Acme",
    text: pageText(HOME),
  },
  {
    kind: "pricing",
    url: "https://acme.example.com/pricing",
    checked_at: "2026-11-08T00:00:00Z",
    title: "Pricing",
    text: pageText(PRICING),
  },
];

describe("review drafts: grounding rules", () => {
  it("pageText drops an unclosed style or script block left by the byte cap", () => {
    const cut = "<title>X</title><p>Real product text.</p><style>.a{color:red}.b{margin:0";
    expect(pageText(cut)).toBe("X Real product text.");
    expect(pageText("<p>Hi</p><script>var a = 1;")).toBe("Hi");
  });

  it("pageText keeps attribute values containing '>' out of the text", () => {
    const html =
      '<div class="md:[&>div]:p-2 data-[x=1]:[&>:nth-child(2)]:bg-red">Plans for teams</div>';
    expect(pageText(html)).toBe("Plans for teams");
  });

  it("pageText drops scripts and markup; pricingUrl finds the pricing link", () => {
    expect(pageText(HOME)).not.toContain("var x");
    expect(pageText(HOME)).toContain("Rewrite paragraphs in 25 languages.");
    expect(pricingUrl(HOME, "https://acme.example.com/")).toBe("https://acme.example.com/pricing");
  });
  it("a quote must really be on the page (3+ words, case and punctuation tolerant)", () => {
    const all = sources()
      .map((s) => s.text)
      .join("\n");
    expect(grounded("generate BLOG posts in seconds", all)).toBe(true);
    expect(grounded("built-in plagiarism checker", all)).toBe(false);
    expect(grounded("Free", all)).toBe(false); // too short to prove anything
  });
  it("keeps only grounded items, records how many were dropped, and verifies pricing from the page", () => {
    const d = buildDraft(
      answer() as any,
      sources(),
      { name: "Acme Writer" },
      "gemini-test",
      "2026-11-08T00:00:00Z",
    );
    expect(d.features).toEqual([
      "Generates blog posts with AI.",
      "Rewrites paragraphs in 25 languages.",
      "Integrates with WordPress and Google Docs.",
    ]);
    expect(d.quality.dropped_ungrounded).toBe(1);
    expect(d.pricing).toEqual({
      model: "freemium",
      summary: "Pro plan at $20 per month with unlimited words.",
      source_url: "https://acme.example.com/pricing",
    });
    expect(d.quality.status).toBe("draft_ready");
    expect(d.sources.map((s) => s.kind)).toEqual(["home", "pricing"]);
  });
  it("pricing without evidence is recorded as unknown, never guessed", () => {
    const d = buildDraft(
      answer({
        pricing: { model: "paid", summary: "Paid only.", evidence: "Paid plans start at $99" },
      }) as any,
      sources(),
      { name: "Acme Writer" },
      "m",
      "t",
    );
    expect(d.pricing.model).toBeNull();
    expect(d.quality.pricing_verified).toBe(false);
  });
  it("a different product, or too little verified, goes to manual review", () => {
    const wrong = buildDraft(
      answer({
        identity: { matches: false, name_on_site: "Parked domain", reason: "domain for sale" },
      }) as any,
      sources(),
      { name: "Acme Writer" },
      "m",
      "t",
    );
    expect(wrong.quality.status).toBe("needs_manual");
    const thin = buildDraft(
      answer({ features: [{ text: "x", evidence: "nothing like this on the page" }] }) as any,
      sources(),
      { name: "Acme Writer" },
      "m",
      "t",
    );
    expect(thin.quality.status).toBe("needs_manual");
    expect(thin.quality.reasons.join()).toMatch(/feature/);
  });
});

describe("review drafts: admin endpoints", () => {
  let key!: TestKey;
  let token = "";
  beforeAll(async () => {
    key = await makeKey("k1");
    token = await signJwt(key, goodClaims(1_800_000_000));
  });
  let db: TestDb;
  let jwks!: JwksProvider;
  let tick = 0;
  let gemini: () => Response;
  beforeEach(() => {
    db = createTestDb({
      seed: [
        `INSERT INTO categories (id,slug,name,subcategories,status) VALUES ('w','writing','Writing','["Assistants"]','published')`,
        `INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,updated_at) VALUES ('a','acme-writer','Acme Writer','https://acme.example.com/','w','Assistants','published','noindex','2026-01-01T00:00:00.000Z')`,
      ],
    });
    jwks = staticJwks(key);
    tick = 0;
    gemini = () =>
      new Response(
        JSON.stringify({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer()) }] } },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("generativelanguage.googleapis.com")) return gemini();
    if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
    const html = u.endsWith("/pricing") ? PRICING : HOME;
    const r = new Response(html, { headers: { "content-type": "text/html" } });
    Object.defineProperty(r, "url", { value: u });
    return r;
  }) as typeof fetch;
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    env: Record<string, unknown> = { ...goodEnv, GEMINI_API_KEY: "test-key" },
  ) => {
    const res = await handleAdminApi(
      new Request(`https://admin.test/api/admin/${path}`, {
        method,
        headers: {
          "cf-access-jwt-assertion": token,
          "x-requested-with": "tryaitools-admin",
          origin: "https://admin.test",
          "content-type": "application/json",
        },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      {
        env: async () => env,
        db: async () => db,
        now: () => `2026-11-08T12:00:${String(++tick).padStart(2, "0")}.000Z`,
        auth: { jwks, nowSeconds: 1_800_000_000 },
        reviewFetch: fakeFetch,
      },
    );
    return { status: res.status, json: await res.json() };
  };
  const tool = () => db.raw.prepare("SELECT * FROM tools WHERE slug = 'acme-writer'").get();

  it("generate stores a grounded draft (not public) and marks the tool draft_ready; approve publishes the content but not indexing", async () => {
    const g = await call("POST", "tools/acme-writer/draft");
    expect(g.status).toBe(200);
    expect(g.json.status).toBe("draft_ready");
    let t = tool();
    expect([t.review_status, t.overview, t.indexing]).toEqual(["draft_ready", null, "noindex"]); // public fields untouched
    expect(JSON.parse(t.review_draft).features).toHaveLength(3);
    const a = await call("POST", "tools/acme-writer/draft/approve", {
      updated_at: t.updated_at,
      checklist: CHECKS,
    });
    expect(a.status).toBe(200);
    t = tool();
    expect(t.review_status).toBe("reviewed");
    expect(JSON.parse(t.features)).toHaveLength(3);
    expect([t.pricing_model, t.pricing_source, t.pricing_checked_at]).toEqual([
      "freemium",
      "https://acme.example.com/pricing",
      "2026-11-08",
    ]);
    const rec = JSON.parse(t.review_sources);
    expect(rec.sources.map((s: any) => s.url)).toEqual([
      "https://acme.example.com/",
      "https://acme.example.com/pricing",
    ]);
    expect(rec.evidence.features).toHaveLength(3);
    expect(rec.quotes_verified_at).toBeTruthy();
    expect(t.best_for).toBe(
      "Marketing teams and freelance writers; Students drafting essays and reports",
    );
    expect(t.indexing).toBe("noindex"); // indexing is a separate, gated step
    expect(
      db.raw
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action IN ('tool.review_draft','tool.review_approve')",
        )
        .get().n,
    ).toBe(2);
  });

  it("the free-quota limit (429) or a missing key changes nothing", async () => {
    const before = tool();
    gemini = () =>
      new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
    const q = await call("POST", "tools/acme-writer/draft");
    expect([q.status, q.json.error.code]).toEqual([503, "ai_quota"]);
    const k = await call("POST", "tools/acme-writer/draft", undefined, { ...goodEnv });
    expect([k.status, k.json.error.code]).toEqual([503, "ai_not_configured"]);
    expect(tool()).toEqual(before);
  });

  it("a draft that needs manual work cannot be approved", async () => {
    gemini = () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(
                      answer({ identity: { matches: false, name_on_site: "x", reason: "parked" } }),
                    ),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    const g = await call("POST", "tools/acme-writer/draft");
    expect(g.json.status).toBe("needs_manual");
    const a = await call("POST", "tools/acme-writer/draft/approve", {
      updated_at: tool().updated_at,
      checklist: CHECKS,
    });
    expect([a.status, a.json.error.code]).toEqual([409, "draft_not_ready"]);
    expect(tool().review_status).toBe("needs_manual");
  });
  // ---------------------------------------------------------------------------------------- workflow G1–G10
  const RICH = {
    tagline: "AI writer for blog posts, rewrites and calendars",
    overview:
      "Acme Writer is a writing assistant that turns a short brief into a full blog post draft and can rewrite existing paragraphs in twenty five languages. Marketing teams use it to plan content calendars for each channel, while freelance writers and students rely on it for first drafts of articles, essays and reports. Finished drafts export as Markdown or HTML, and editors can leave comments and restore earlier versions. It connects with WordPress and Google Docs, so text moves into publishing without copying. A free plan covers light use, and a paid Pro plan removes the monthly word limit for heavier work.",
    features: [
      { text: "Turns a brief into a blog post draft.", evidence: "Generate blog posts in seconds" },
      {
        text: "Rewrites paragraphs in 25 languages.",
        evidence: "Rewrite paragraphs in 25 languages",
      },
      {
        text: "Connects to WordPress and Google Docs.",
        evidence: "Integrates with WordPress and Google Docs",
      },
      {
        text: "Plans content calendars per channel.",
        evidence: "Plan content calendars for every channel",
      },
      {
        text: "Exports drafts as Markdown or HTML.",
        evidence: "Export finished drafts as Markdown or HTML",
      },
      {
        text: "Comments and version history for editors.",
        evidence: "Collaborate with comments and version history",
      },
    ],
  };
  const answerWith = (o: Record<string, unknown>) => () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(answer(o)) }] } }],
      }),
      { headers: { "content-type": "application/json" } },
    );
  const approve = (body: Record<string, unknown> = {}) =>
    call("POST", "tools/acme-writer/draft/approve", {
      updated_at: tool().updated_at,
      checklist: CHECKS,
      ...body,
    });
  const listed = () =>
    db.raw
      .prepare(
        "SELECT count(*) n FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = 'acme-writer' AND t.status = 'published' AND t.needs_review = 0 AND c.status = 'published' AND t.indexing = 'index'",
      )
      .get().n;
  const revert = () =>
    call("POST", "tools/acme-writer/draft/revert", { updated_at: tool().updated_at });

  it("approval keeps the verified pricing when the draft has none (no data loss)", async () => {
    db.raw.exec(
      "UPDATE tools SET pricing_model = 'freemium', pricing_source = 'https://acme.example.com/pricing', pricing_checked_at = '2026-11-01' WHERE slug = 'acme-writer'",
    );
    gemini = answerWith({ pricing: { model: "unknown", summary: "", evidence: "" } });
    expect((await call("POST", "tools/acme-writer/draft")).json.status).toBe("draft_ready");
    const a = await approve();
    expect([a.status, a.json.pricing]).toEqual([200, "kept"]);
    const t = tool();
    expect([t.pricing_model, t.pricing_source, t.pricing_checked_at]).toEqual([
      "freemium",
      "https://acme.example.com/pricing",
      "2026-11-01",
    ]);
    expect(JSON.parse(t.review_sources).pricing_kept.model).toBe("freemium");
  });

  it("the editor can edit claims before approval, but cannot add one without its quote", async () => {
    await call("POST", "tools/acme-writer/draft");
    const content = {
      tagline: "Blog drafts and rewrites for writing teams",
      overview: answer().overview,
      features: [
        { text: "Writes blog post drafts quickly.", ref: 0 },
        { text: "Rewrites text in 25 languages.", ref: 1 },
      ],
      best_for: [{ text: "Marketing teams", ref: 0 }],
      pros: [],
      limits: [],
      pricing: { choice: "draft", summary: "Pro plan at $20 per month." },
      seo_title: "Acme Writer: AI blog drafts",
      seo_description: "x".repeat(130),
    };
    const extra = await approve({
      content: { ...content, features: [...content.features, { text: "Invented.", ref: 7 }] },
    });
    expect([extra.status, extra.json.error.code]).toEqual([422, "unquoted_claim"]);
    const price = await approve({
      content: { ...content, pricing: { choice: "draft", summary: "Pro plan at $15 per month." } },
    });
    expect([price.status, price.json.error.code]).toEqual([422, "pricing_unsupported"]);
    expect(tool().review_status).toBe("draft_ready"); // nothing changed by the refused attempts
    const ok = await approve({ content });
    expect(ok.status).toBe(200);
    const t = tool();
    expect(JSON.parse(t.features)).toEqual([
      "Writes blog post drafts quickly.",
      "Rewrites text in 25 languages.",
    ]);
    expect(JSON.parse(t.review_sources).evidence.features).toEqual([
      "Generate blog posts in seconds",
      "Rewrite paragraphs in 25 languages",
    ]);
    expect(t.tagline).toBe("Blog drafts and rewrites for writing teams");
  });

  it("approval stores the previous values; revert restores them exactly and forces noindex", async () => {
    db.raw.exec(
      "UPDATE tools SET pricing_model = 'paid', pricing_note = 'old note' WHERE slug = 'acme-writer'",
    );
    await call("POST", "tools/acme-writer/draft");
    const drafted = tool();
    await approve();
    const h = db.raw.prepare("SELECT * FROM tool_review_history WHERE slug = 'acme-writer'").all();
    expect(h).toHaveLength(1);
    expect(JSON.parse(h[0].before).overview).toBeNull();
    expect(JSON.parse(h[0].before).pricing_note).toBe("old note");
    expect(JSON.parse(h[0].checklist).category_id).toBe("w");
    expect(JSON.parse(h[0].draft).sources[0].text).toContain("Generate blog posts");
    db.raw.exec("UPDATE tools SET indexing = 'index' WHERE slug = 'acme-writer'"); // even if it was indexed
    const r = await revert();
    expect(r.status).toBe(200);
    const t = tool();
    for (const k of [
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
    ])
      expect(t[k], k).toEqual(drafted[k]);
    expect(t.indexing).toBe("noindex");
    const again = await revert();
    expect([again.status, again.json.error.code]).toEqual([409, "nothing_to_revert"]);
  });

  it("approval refuses until the editor fixes lengths and the SEO title", async () => {
    gemini = answerWith({ tagline: "One two" });
    await call("POST", "tools/acme-writer/draft");
    expect(JSON.parse(tool().review_draft).quality.fixes).toEqual([
      "tagline has 2 words (needs 3-12)",
    ]);
    const a = await approve();
    expect([a.status, a.json.error.code]).toEqual([422, "needs_fixes"]);
    expect(a.json.error.message).toMatch(/tagline has 2 words/);
    const d = JSON.parse(tool().review_draft);
    const content = {
      tagline: "AI writer for blog posts",
      overview: d.overview,
      features: d.features.map((text: string, ref: number) => ({ text, ref })),
      best_for: d.best_for.map((text: string, ref: number) => ({ text, ref })),
      pros: [],
      limits: [],
      pricing: { choice: "draft", summary: d.pricing.summary },
      seo_title: "Blog writer",
      seo_description: d.seo_description,
    };
    expect((await approve({ content })).json.error.message).toMatch(/SEO title must name the tool/);
    expect(
      (await approve({ content: { ...content, seo_title: "Acme Writer: blog posts" } })).status,
    ).toBe(200);
  });

  it("revert refuses to overwrite edits made after the approval", async () => {
    await call("POST", "tools/acme-writer/draft");
    await approve();
    db.raw.exec("UPDATE tools SET tagline = 'Edited by hand later' WHERE slug = 'acme-writer'");
    const r = await revert();
    expect([r.status, r.json.error.code]).toEqual([409, "edited_since_approval"]);
    expect(tool().tagline).toBe("Edited by hand later");
  });

  it("approval never changes indexing; unapproved or rejected drafts stay private and noindex", async () => {
    await call("POST", "tools/acme-writer/draft");
    let t = tool();
    expect([t.overview, t.features, t.indexing]).toEqual([null, null, "noindex"]);
    await call("POST", "tools/acme-writer/draft/reject", { updated_at: t.updated_at });
    t = tool();
    expect([t.review_draft, t.overview, t.indexing, t.review_status]).toEqual([
      null,
      null,
      "noindex",
      "needs_manual",
    ]);
    await call("POST", "tools/acme-writer/draft");
    await approve();
    expect(tool().indexing).toBe("noindex");
    expect(listed()).toBe(0);
  });

  it("drafts with unsupported pricing, too few use cases or outdated-product signals need manual work", () => {
    const d = (o: Record<string, unknown>, extra = "") =>
      buildDraft(
        answer(o) as any,
        extra ? [...sources(), { ...sources()[0]!, kind: "pricing", text: extra }] : sources(),
        { name: "Acme Writer", url: "https://acme.example.com/" },
        "m",
        "2026-11-08T00:00:00Z",
      );
    // an unsupported pricing summary is removed (never published); the model its quote supports is kept
    const p = d({
      pricing: {
        model: "freemium",
        summary: "Free and Business plans from $12 a month.",
        evidence: "Pro plan: $20 per month, unlimited words",
      },
    });
    expect([p.quality.status, p.pricing.model, p.pricing.summary]).toEqual([
      "draft_ready",
      "freemium",
      "",
    ]);
    expect(p.quality.notes!.join()).toMatch(
      /pricing summary removed: it stated 12, free, business/,
    );
    // lengths are the editor's to fix, not manual research
    const long = d({
      tagline: "A tagline that is far too long to be accepted by the directory rules at all",
    });
    expect([long.quality.status, long.quality.fixes!.join()]).toEqual([
      "draft_ready",
      "tagline has 16 words (needs 3-12)",
    ]);
    expect(d({ use_cases: [] }).quality.reasons.join()).toMatch(/0 use case/);
    expect(
      d(
        {},
        "Acme Writer is now part of Globex Corporation. Thanks for the ride.",
      ).quality.reasons.join(),
    ).toMatch(/check the product: page says "is now part of"/);
  });

  it("indexing: refused by G1–G10 through every path until the tool passes; then it is listed", async () => {
    const idx = () =>
      call("POST", "tools/acme-writer/indexing", {
        indexing: "index",
        updated_at: tool().updated_at,
      });
    // no review at all
    let r = await idx();
    expect([r.status, r.json.error.code]).toEqual([422, "index_gate"]);
    expect(r.json.error.message).toMatch(/G1: .*G9: not reviewed/);
    // an approved but thin review: too little own text (G8)
    await call("POST", "tools/acme-writer/draft");
    await approve();
    r = await idx();
    expect(r.status).toBe(422);
    expect(r.json.error.message).toMatch(/G8: /);
    // the tool editor's save cannot index it either
    const g = (await call("GET", "tools/acme-writer")).json.tool;
    const put = await call("PUT", "tools/acme-writer", {
      name: g.name,
      url: g.url,
      category_id: g.category_id,
      subcategory: g.subcategory,
      tags: [],
      indexing: "index",
      tagline: g.tagline,
      overview: g.overview,
      best_for: g.best_for,
      features: g.features,
      pros: g.pros,
      limits: g.limits,
      pricing_model: g.pricing_model,
      pricing_source: g.pricing_source,
      pricing_note: g.pricing_note,
      pricing_checked_at: g.pricing_checked_at,
      updated_at: g.updated_at,
    });
    expect([put.status, put.json.error?.code]).toEqual([422, "index_gate"]);
    expect(listed()).toBe(0);
    // a full review, but the category was not confirmed (G10)
    expect((await revert()).status).toBe(200);
    gemini = answerWith(RICH);
    await call("POST", "tools/acme-writer/draft");
    await approve({ checklist: { ...CHECKS, category_confirmed: false } });
    r = await idx();
    expect(r.json.error.message).toBe(
      "This tool cannot be indexed: G10: category not confirmed by the editor",
    );
    const gate = (await call("GET", "tools/acme-writer/gate")).json;
    expect(gate.checks.filter((c: any) => !c.ok).map((c: any) => c.id)).toEqual(["G10"]);
    // approved again with the category confirmed: every check passes; indexing is still a separate, explicit step
    expect((await revert()).status).toBe(200);
    await call("POST", "tools/acme-writer/draft");
    await approve();
    expect((await call("GET", "tools/acme-writer/gate")).json.passes).toBe(true);
    expect(listed()).toBe(0);
    r = await idx();
    expect(r.status).toBe(200);
    expect(listed()).toBe(1);
    expect(
      db.raw.prepare("SELECT count(*) n FROM audit_events WHERE action = 'tool.index_enable'").get()
        .n,
    ).toBe(1);
  });
});

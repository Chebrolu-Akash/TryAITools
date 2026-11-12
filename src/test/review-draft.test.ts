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
<p>Start free, no credit card required.</p></body></html>`;
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
  advantages: [{ text: "Free plan available.", evidence: "Free plan: 2,000 words per month" }],
  limitations: [
    {
      text: "The free plan is capped at 2,000 words a month.",
      evidence: "Free plan: 2,000 words per month",
    },
  ],
  pricing: {
    model: "freemium",
    summary: "Free plan plus a $20/month Pro plan.",
    evidence: "Pro plan: $20 per month, unlimited words",
  },
  seo_title: "Acme Writer: AI blog post writer",
  seo_description:
    "Acme Writer drafts blog posts and rewrites paragraphs in 25 languages, with WordPress and Google Docs integrations. Freemium: free plan plus Pro.",
  ...o,
});
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
      summary: "Free plan plus a $20/month Pro plan.",
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
    const a = await call("POST", "tools/acme-writer/draft/approve", { updated_at: t.updated_at });
    expect(a.status).toBe(200);
    t = tool();
    expect(t.review_status).toBe("reviewed");
    expect(JSON.parse(t.features)).toHaveLength(3);
    expect([t.pricing_model, t.pricing_source, t.pricing_checked_at]).toEqual([
      "freemium",
      "https://acme.example.com/pricing",
      "2026-11-08",
    ]);
    expect(JSON.parse(t.review_sources).map((s: any) => s.url)).toEqual([
      "https://acme.example.com/",
      "https://acme.example.com/pricing",
    ]);
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
    });
    expect([a.status, a.json.error.code]).toEqual([409, "draft_not_ready"]);
    expect(tool().review_status).toBe("needs_manual");
  });
});

// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses and rows in tests */
// AI News: feed parsing, robots.txt, duplicate detection, the Gemini summariser (mocked HTTP), the ingestion pipeline
// against the real migrations in SQLite, the public reader, the static-site gate and the admin API.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi } from "@/lib/admin/api";
import type { JwksProvider } from "@/lib/admin/jwt";
import { canonicalUrl, findSimilar, significantWords, titleKey } from "@/lib/news/dedupe";
import { parseFeed } from "@/lib/news/feed";
import { runIngestion } from "@/lib/news/ingest";
import {
  NEWS_IMAGE_SOURCES,
  isAllowedNewsImage,
  slugify,
  validateNewsSearch,
} from "@/lib/news/model";
import { CONTENT_SECURITY_POLICY } from "@/lib/security-headers";
import { readFileSync } from "node:fs";
import { createNewsReader, likePattern } from "@/lib/news/reader";
import { robotsAllows } from "@/lib/news/robots";
import { createSummarizer, validateSummary } from "@/lib/news/summarize";
import { classify, decide, type Freshness } from "@/static/freshness";
import { BUILD_INFO_PATH, createGate } from "@/static/gate";
import { contentEntries } from "@/static/sitemap";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { assertSqliteAvailable, createTestDb, type TestDb } from "./helpers/sqlite-d1";

afterEach(() => vi.restoreAllMocks());

// ------------------------------------------------------------------ fixtures
const words = (n: number, w = "update") => Array.from({ length: n }, () => w).join(" ");
const LONG_TEXT = `OpenAI announced GPT-9 Turbo, a new language model for developers. ${words(80, "detail")}. The model is available in the API today.`;

const rss = (
  items: { title: string; link: string; guid?: string; date?: string; text?: string }[],
) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Feed</title>${items
    .map(
      (i) =>
        `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link>${i.guid ? `<guid>${i.guid}</guid>` : ""}<pubDate>${i.date ?? "Sat, 31 Oct 2026 10:00:00 GMT"}</pubDate><description>${(i.text ?? LONG_TEXT).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</description><media:content url="https://blogs.nvidia.com/wp-content/uploads/2026/10/${encodeURIComponent(i.title)}.jpg" medium="image"/></item>`,
    )
    .join("")}</channel></rss>`;

const summaryJson = (o: Record<string, unknown> = {}) => ({
  insufficient: false,
  insufficient_reason: "",
  headline: "OpenAI Launches GPT-9 Turbo for Developers",
  summary: `${words(60, "summary")}\n\n${words(60, "second")}`,
  card_description: words(30, "card"),
  takeaways: ["One takeaway.", "Two takeaway.", "Three takeaway."],
  category: "model-releases",
  tags: ["LLM", "openai", "api"],
  companies: ["OpenAI", "Invented Corp"],
  products: ["GPT-9 Turbo"],
  ...o,
});
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
/** A generateContent response: a thought part (ignored) plus the JSON answer. */
const geminiResponse = (
  body: unknown,
  o: Record<string, unknown> = {},
  finishReason = "STOP",
  raw = false,
) =>
  new Response(
    JSON.stringify({
      modelVersion: "gemini-3.5-flash-lite",
      candidates: [
        {
          finishReason,
          content: {
            parts: [
              { text: "thinking...", thought: true },
              { text: raw ? String(body) : JSON.stringify(body) },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, thoughtsTokenCount: 100 },
      ...o,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

/** A fetch double: routes by URL; records every call. */
function fakeFetch(
  routes: Record<
    string,
    (req: { url: string; init?: RequestInit | undefined }) => Response | Promise<Response>
  >,
) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const route =
      routes[url] ??
      Object.entries(routes).find(([k]) => k.endsWith("*") && url.startsWith(k.slice(0, -1)))?.[1];
    if (!route) return new Response("not found", { status: 404 });
    return route({ url, init });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

// ------------------------------------------------------------------ pure helpers
describe("feed parser", () => {
  it("reads RSS items with CDATA titles, entity-encoded HTML descriptions and media images, newest first, up to max", () => {
    const xml = rss([
      {
        title: "First &amp; best",
        link: "https://openai.com/news/a/?utm_source=rss",
        guid: "g1",
        text: "<p>Hello <b>world</b> &amp; more</p>",
      },
      { title: "Second", link: "https://openai.com/news/b/" },
      { title: "Third", link: "https://openai.com/news/c/" },
    ]);
    const items = parseFeed(xml, 2);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "First & best",
      link: "https://openai.com/news/a/?utm_source=rss",
      guid: "g1",
      text: "Hello world & more",
      publishedAt: "2026-10-31T10:00:00.000Z",
    });
    expect(items[0]!.imageUrl).toMatch(/^https:\/\/blogs\.nvidia\.com\/wp-content\/uploads\//);
  });

  it("reads Atom entries (alternate link, id, published, content) and drops an item cut off by the byte cap", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>
      <entry><title>Atom post</title><link rel="self" href="https://x.test/self"/><link rel="alternate" href="https://blog.test/post"/>
      <id>tag:blog.test,1</id><published>2026-10-30T08:00:00Z</published><content type="html">&lt;p&gt;Body text&lt;/p&gt;</content></entry>
      <entry><title>Cut</title><link href="https://blog.test/cut"/>`;
    const items = parseFeed(xml, 10);
    expect(items).toEqual([
      expect.objectContaining({
        title: "Atom post",
        link: "https://blog.test/post",
        guid: "tag:blog.test,1",
        text: "Body text",
      }),
    ]);
  });

  it("rejects a document that is not a feed and skips items without an https link", () => {
    expect(() => parseFeed("<html><body>hi</body></html>")).toThrow(/not an RSS or Atom feed/);
    expect(parseFeed(rss([{ title: "x", link: "javascript:alert(1)" }]))).toEqual([]);
  });
});

describe("robots.txt", () => {
  const url = "https://site.test/feed/";
  it("allows when there is no rule, follows the * group, and lets the longest rule win (Allow on a tie)", () => {
    expect(robotsAllows("", url)).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", url)).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /feed/", url)).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /fe*\nAllow: /feed", url)).toBe(true);
    expect(robotsAllows("User-agent: GPTBot\nDisallow: /", url)).toBe(true); // a different bot's rule
  });
  it("honours rules for our own agent and Google's AI opt-out token (Google-Extended)", () => {
    expect(robotsAllows("User-agent: TryAITools-NewsBot\nDisallow: /feed", url)).toBe(false);
    expect(robotsAllows("User-agent: Google-Extended\nDisallow: /", url)).toBe(false);
    expect(robotsAllows("User-agent: Google-Extended\nUser-agent: GPTBot\nDisallow: /", url)).toBe(
      false,
    );
    expect(robotsAllows("User-agent: ClaudeBot\nDisallow: /", url)).toBe(true); // not the model in use
    // a named group replaces the * group for that agent
    expect(
      robotsAllows("User-agent: *\nDisallow: /\n\nUser-agent: TryAITools-NewsBot\nAllow: /", url),
    ).toBe(true);
  });
});

describe("article images", () => {
  it("only https images under the official sources' media paths are allowed", () => {
    for (const ok of [
      "https://blogs.nvidia.com/wp-content/uploads/2026/10/a.jpg",
      "https://www.microsoft.com/en-us/research/wp-content/uploads/2026/10/b.jpg",
      "https://storage.googleapis.com/gweb-uniblog-publish-prod/images/c.webp",
      "https://lh3.googleusercontent.com/abc=w528-h297",
    ])
      expect(isAllowedNewsImage(ok), ok).toBe(true);
    for (const bad of [
      "http://blogs.nvidia.com/wp-content/uploads/a.jpg", // not https
      "https://storage.googleapis.com/some-other-bucket/x.png", // shared host, other path
      "https://blogs.nvidia.com/feed/", // allowed host, not the media path
      "https://evil.test/wp-content/uploads/a.jpg",
      "https://user:pw@blogs.nvidia.com/wp-content/uploads/a.jpg",
      "https://blogs.nvidia.com:8443/wp-content/uploads/a.jpg",
      "javascript:alert(1)",
      null,
    ])
      expect(isAllowedNewsImage(bad), String(bad)).toBe(false);
  });

  it("the Content-Security-Policy allows exactly those image sources, and public/_headers has the same policy", () => {
    const imgSrc = CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith("img-src "))!;
    for (const s of NEWS_IMAGE_SOURCES) expect(imgSrc.split(" ")).toContain(s);
    const headers = readFileSync("public/_headers", "utf8");
    expect(headers).toContain(`Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`);
  });

  it("the feed parser skips WordPress emoji, pixels and tiny icons and takes the first real image", () => {
    const html =
      '<p><img src="https://s.w.org/images/core/emoji/17.0.2/72x72/1f517.png" alt="🔗" class="wp-smiley" />' +
      '<img src="https://blogs.nvidia.com/wp-content/uploads/pixel.gif" width="1" height="1" />' +
      '<img src="https://blogs.nvidia.com/wp-content/uploads/2026/10/icon.png" width="64" height="64" />' +
      '<img src="https://blogs.nvidia.com/wp-content/uploads/2026/10/hero.jpg" width="1280" height="680" /></p>';
    const xml = `<rss><channel><item><title>A story about a model</title><link>https://blogs.nvidia.com/blog/a</link><description>${html.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</description></item></channel></rss>`;
    expect(parseFeed(xml)[0]!.imageUrl).toBe(
      "https://blogs.nvidia.com/wp-content/uploads/2026/10/hero.jpg",
    );
  });

  it("the reader re-checks stored image URLs, so older rows with a disallowed image fall back to the placeholder", async () => {
    const db = createTestDb();
    const row = (id: string, slug: string, url: string, img: string | null) =>
      `INSERT INTO news_articles (id, slug, source_id, source_name, canonical_url, title_key, original_title, title, summary,
         card_description, category, status, collected_at, published_at, image_url)
       VALUES ('${id}', '${slug}', 'nvidia', 'NVIDIA', '${url}', '${slug}', 'T', 'Title ${slug}', 'S', 'C', 'research',
         'published', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', ${img ? `'${img}'` : "NULL"})`;
    db.raw.exec(
      row(
        "a1",
        "good-image",
        "https://n.test/1",
        "https://blogs.nvidia.com/wp-content/uploads/x.jpg",
      ),
    );
    db.raw.exec(row("a2", "bad-image", "https://n.test/2", "https://cdn.example.com/x.jpg"));
    db.raw.exec(row("a3", "no-image", "https://n.test/3", null));
    const items = (await createNewsReader(db).list({ page: 1 })).items;
    const bySlug = Object.fromEntries(items.map((i) => [i.slug, i.imageUrl]));
    expect(bySlug).toEqual({
      "good-image": "https://blogs.nvidia.com/wp-content/uploads/x.jpg",
      "bad-image": null,
      "no-image": null,
    });
    expect((await createNewsReader(db).item("bad-image"))!.imageUrl).toBeNull();
  });
});

describe("duplicate detection", () => {
  it("canonical URLs drop tracking params, fragments, www and trailing slashes", () => {
    expect(canonicalUrl("http://www.Example.com/a/b/?utm_source=x&b=2&a=1#top")).toBe(
      "https://example.com/a/b?a=1&b=2",
    );
    expect(canonicalUrl("not a url")).toBeNull();
    expect(canonicalUrl("ftp://x.test/a")).toBeNull();
  });
  it("headline keys ignore case and punctuation; similar headlines are the same story", () => {
    expect(titleKey("OpenAI’s GPT-9: Now Live!")).toBe("openais gpt 9 now live");
    const recent = [
      {
        id: "a",
        words: significantWords(titleKey("OpenAI launches GPT-9 Turbo model for developers")),
      },
    ];
    expect(findSimilar(titleKey("OpenAI unveils GPT-9 Turbo model for developers"), recent)).toBe(
      "a",
    );
    expect(findSimilar(titleKey("Google releases Gemini 4 for phones today"), recent)).toBeNull();
    expect(findSimilar(titleKey("GPT-9"), recent)).toBeNull(); // too few words to judge
  });
  it("slugify keeps slugs ASCII and bounded", () => {
    expect(slugify("Ünïcode & Things: GPT-9 is here!")).toBe("unicode-and-things-gpt-9-is-here");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(70);
  });
  it("listing search params drop defaults and clamp pages", () => {
    expect(validateNewsSearch({ q: "  claude ", page: "2" })).toEqual({ q: "claude", page: 2 });
    expect(validateNewsSearch({ page: "-4", q: "" })).toEqual({});
    expect(validateNewsSearch({ page: "99999" })).toEqual({ page: 500 });
  });
});

describe("summariser (Gemini free tier)", () => {
  const input = {
    title: "OpenAI announces GPT-9 Turbo",
    text: LONG_TEXT,
    sourceName: "OpenAI",
    url: "https://openai.com/news/gpt-9",
    publishedAt: null,
    defaultCategory: null,
  };
  const run = async (res: () => Response) =>
    createSummarizer({ apiKey: "k", fetch: fakeFetch({ [GEMINI_URL]: res }).fn }).summarize(input);
  const apiError =
    (status: number, code: string, details: unknown[] = []) =>
    () =>
      new Response(
        JSON.stringify({ error: { code: status, status: code, message: "msg", details } }),
        {
          status,
        },
      );

  it("sends one generateContent request (key header, JSON schema output, low thinking) and keeps only grounded names", async () => {
    let sent: any;
    let headers: Record<string, string> = {};
    const f = fakeFetch({
      [GEMINI_URL]: ({ init }) => {
        sent = JSON.parse(String(init?.body));
        headers = Object.fromEntries(new Headers(init?.headers).entries());
        return geminiResponse(summaryJson());
      },
    });
    const r = await createSummarizer({ apiKey: "test-key", fetch: f.fn }).summarize(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.calls).toEqual([GEMINI_URL]);
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(sent.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(sent.generationConfig.responseJsonSchema.required).toContain("takeaways");
    expect(sent.systemInstruction.parts[0].text).toMatch(/Use ONLY facts/);
    expect(sent.contents[0].parts[0].text).toContain("<article>");
    expect(r.summary.companies).toEqual(["OpenAI"]); // "Invented Corp" is not in the source text
    expect(r.summary.products).toEqual(["GPT-9 Turbo"]);
    expect(r.summary.tags).toEqual(["llm", "openai", "api"]);
    // thinking tokens count as output; the free tier costs nothing
    expect(r.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0,
      model: "gemini-3.5-flash-lite",
    });
  });

  it("skips thin source text without calling the model, and reports the model's own 'insufficient' answer", async () => {
    const f = fakeFetch({
      [GEMINI_URL]: () =>
        geminiResponse(summaryJson({ insufficient: true, insufficient_reason: "only a teaser" })),
    });
    const s = createSummarizer({ apiKey: "k", fetch: f.fn });
    const thin = await s.summarize({ ...input, text: "Short teaser." });
    expect(thin).toMatchObject({ ok: false, reason: "insufficient", retryable: false });
    expect(f.calls).toHaveLength(0);
    expect(await s.summarize(input)).toMatchObject({
      ok: false,
      reason: "insufficient",
      message: "only a teaser",
    });
  });

  it("free quota and rate limits (429) are deferred and stop the run, never retried here", async () => {
    let n = 0;
    const f = fakeFetch({
      [GEMINI_URL]: () => {
        n++;
        return apiError(429, "RESOURCE_EXHAUSTED", [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
          },
        ])();
      },
    });
    const r = await createSummarizer({ apiKey: "k", fetch: f.fn }).summarize(input);
    expect(r).toMatchObject({ ok: false, reason: "deferred", stopRun: true });
    expect(r.ok ? "" : r.message).toMatch(/daily quota used up/);
    expect(n).toBe(1);
    expect(await run(apiError(429, "RESOURCE_EXHAUSTED"))).toMatchObject({
      reason: "deferred",
      stopRun: true,
      message: expect.stringMatching(/rate limit/),
    });
  });

  it("a bad key or model (400/403/404) is deferred and stops the run; 5xx is retried once, then deferred", async () => {
    expect(await run(apiError(403, "PERMISSION_DENIED"))).toMatchObject({
      reason: "deferred",
      stopRun: true,
    });
    expect(await run(apiError(404, "NOT_FOUND"))).toMatchObject({
      reason: "deferred",
      stopRun: true,
    });
    let n = 0;
    const f = fakeFetch({
      [GEMINI_URL]: () =>
        ++n === 1 ? apiError(503, "UNAVAILABLE")() : geminiResponse(summaryJson()),
    });
    expect((await createSummarizer({ apiKey: "k", fetch: f.fn }).summarize(input)).ok).toBe(true);
    expect(n).toBe(2);
    expect(await run(apiError(503, "UNAVAILABLE"))).toMatchObject({
      reason: "deferred",
      stopRun: false,
    });
  });

  it("classifies blocked input/answers, cut-off answers, bad JSON and wrong lengths", async () => {
    expect(
      await run(() => geminiResponse(summaryJson(), { promptFeedback: { blockReason: "SAFETY" } })),
    ).toMatchObject({
      reason: "refusal",
      retryable: false,
    });
    expect(await run(() => geminiResponse(summaryJson(), {}, "RECITATION"))).toMatchObject({
      reason: "refusal",
    });
    expect(await run(() => geminiResponse(summaryJson(), {}, "MAX_TOKENS"))).toMatchObject({
      reason: "invalid",
      retryable: true,
    });
    expect(await run(() => geminiResponse("{oops" as any, {}, "STOP", true))).toMatchObject({
      reason: "invalid",
    });
    expect(await run(() => geminiResponse(summaryJson({ summary: "Too short." })))).toMatchObject({
      reason: "invalid",
      message: expect.stringMatching(/summary has 2 words/),
    });
  });

  it("only gemini-* model names are accepted from NEWS_MODEL; no key means no summariser", async () => {
    const { summarizerFromEnv } = await import("@/lib/news/cron");
    expect(summarizerFromEnv({})).toBeNull();
    expect(summarizerFromEnv({ GEMINI_API_KEY: "k", NEWS_MODEL: "claude-sonnet-5-5" })!.model).toBe(
      "gemini-3.5-flash-lite",
    );
    expect(summarizerFromEnv({ GEMINI_API_KEY: "k", NEWS_MODEL: "gemini-2.5-flash" })!.model).toBe(
      "gemini-2.5-flash",
    );
  });

  it("validateSummary enforces the editorial ranges", () => {
    expect(validateSummary(summaryJson({ takeaways: ["a", "b"] }) as any, LONG_TEXT)).toEqual({
      ok: false,
      message: "2 takeaways",
    });
    expect(
      validateSummary(summaryJson({ card_description: "Too short" }) as any, LONG_TEXT).ok,
    ).toBe(false);
    expect(validateSummary(summaryJson() as any, LONG_TEXT).ok).toBe(true);
  });
});

// ------------------------------------------------------------------ pipeline against real SQL
describe("ingestion pipeline (real migrations in SQLite)", () => {
  it("a SQLite engine is available, so these tests really run", () => assertSqliteAvailable());

  let db: TestDb;
  let clock: Date;
  const now = () => clock;
  const one = (sql: string, ...p: unknown[]) => db.raw.prepare(sql).get(...p);
  const all = (sql: string, ...p: unknown[]) => db.raw.prepare(sql).all(...p);
  beforeEach(() => {
    db = createTestDb();
    // Only two enabled sources, so the round-robin is predictable.
    db.raw.exec("UPDATE news_sources SET enabled = 0");
    db.raw.exec("UPDATE news_sources SET enabled = 1 WHERE id IN ('openai', 'hugging-face')");
    clock = new Date("2026-11-01T12:00:00.000Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const feeds = (extra: Record<string, any> = {}) =>
    fakeFetch({
      "https://openai.com/robots.txt": () => new Response("User-agent: *\nAllow: /"),
      "https://huggingface.co/robots.txt": () => new Response("", { status: 404 }),
      "https://openai.com/news/rss.xml": () =>
        new Response(
          rss([
            {
              title: "OpenAI launches GPT-9 Turbo model for developers",
              link: "https://openai.com/news/gpt-9/?utm_source=rss",
              guid: "oa-1",
            },
            {
              title: "Introducing the OpenAI Safety Hub",
              link: "https://openai.com/news/safety-hub/",
              guid: "oa-2",
            },
            {
              title: "Very old post from last year",
              link: "https://openai.com/news/old/",
              date: "Mon, 01 Sep 2025 10:00:00 GMT",
            },
          ]),
          { headers: { etag: '"v1"' } },
        ),
      "https://huggingface.co/blog/feed.xml": () =>
        new Response(
          rss([
            // same story as OpenAI's first item, other wording: counted as coverage, not a new article
            {
              title: "OpenAI unveils GPT-9 Turbo model for developers",
              link: "https://huggingface.co/blog/gpt-9",
            },
            {
              title: "Hugging Face releases SmolLM 4",
              link: "https://huggingface.co/blog/smollm4",
              text: "Too short to summarise.",
            },
          ]),
        ),
      [GEMINI_URL]: ({ init }) => {
        const body = JSON.parse(String(init?.body));
        const title = /<title>(.*)<\/title>/.exec(body.contents[0].parts[0].text)?.[1] ?? "";
        return geminiResponse(summaryJson({ headline: `Summary: ${title}`.slice(0, 90) }));
      },
      ...extra,
    });

  it("collects, validates, dedupes, summarises, publishes and logs a run; a second run adds nothing", async () => {
    const f = feeds();
    const summarizer = createSummarizer({ apiKey: "k", fetch: f.fn });
    const r = await runIngestion({
      db,
      summarizer,
      trigger: "cron",
      fetch: f.fn,
      now,
      config: { maxSummaries: 10 },
    });

    expect(r).toMatchObject({
      status: "partial",
      sourcesChecked: 2,
      itemsNew: 3,
      duplicates: 1,
      published: 2,
      skippedItems: 1,
    });
    const rows = all(
      "SELECT status, canonical_url, coverage_count, image_url, slug FROM news_articles ORDER BY canonical_url",
    );
    expect(rows.map((x: any) => [x.canonical_url, x.status])).toEqual([
      ["https://huggingface.co/blog/smollm4", "skipped"],
      ["https://openai.com/news/gpt-9", "published"],
      ["https://openai.com/news/safety-hub", "published"],
    ]);
    const gpt9 = rows.find((x: any) => x.canonical_url.endsWith("gpt-9"));
    expect(gpt9.coverage_count).toBe(2); // Hugging Face reported the same story
    expect(gpt9.image_url).toMatch(/^https:\/\/blogs\.nvidia\.com\/wp-content\/uploads\//); // allowed host
    expect(gpt9.slug).toMatch(
      /^summary-openai-launches-gpt-9-turbo-model-for-developers-[0-9a-f]{6}$/,
    );
    const run = one("SELECT * FROM news_runs WHERE id = ?", r.runId);
    expect(run).toMatchObject({
      status: "partial",
      trigger: "cron",
      published: 2,
      input_tokens: 2000,
      output_tokens: 1000, // answer + thinking tokens
    });
    expect(run.cost_usd).toBe(0); // free tier
    expect(all("SELECT stage FROM news_failures").map((x: any) => x.stage)).toEqual(["summarize"]);
    expect(one("SELECT value FROM meta WHERE key = 'news_version'").value).not.toBe("initial");
    expect(one("SELECT etag, robots_status FROM news_sources WHERE id = 'openai'")).toEqual({
      etag: '"v1"',
      robots_status: "allowed",
    });

    // Second run: same feeds, nothing new; no further model calls.
    clock = new Date("2026-11-01T15:00:00.000Z");
    const modelCalls = f.calls.filter((u) => u === GEMINI_URL).length;
    const r2 = await runIngestion({ db, summarizer, trigger: "cron", fetch: f.fn, now });
    expect(r2).toMatchObject({ itemsNew: 0, duplicates: 4, published: 0 });
    expect(f.calls.filter((u) => u === GEMINI_URL).length).toBe(modelCalls);
    expect(one("SELECT count(*) AS n FROM news_articles").n).toBe(3);
  });

  it("a failing or robots-disallowed source is logged and does not block the others", async () => {
    const f = feeds({
      "https://openai.com/robots.txt": () =>
        new Response("User-agent: Google-Extended\nDisallow: /"),
      "https://huggingface.co/blog/feed.xml": () => new Response("oops", { status: 500 }),
    });
    db.raw.exec(
      "INSERT INTO news_sources (id, name, feed_url, site_url) VALUES ('good', 'Good', 'https://good.test/feed', 'https://good.test/')",
    );
    const g = fakeFetch({
      "https://good.test/robots.txt": () => new Response(""),
      "https://good.test/feed": () =>
        new Response(rss([{ title: "Good news about a new model", link: "https://good.test/a" }])),
    });
    const both: typeof fetch = (async (i: any, init?: any) => {
      const url = typeof i === "string" ? i : i.url;
      return url.includes("good.test") ? g.fn(i, init) : f.fn(i, init);
    }) as typeof fetch;
    const r = await runIngestion({ db, summarizer: null, trigger: "manual", fetch: both, now });
    const by = Object.fromEntries(r.sources.map((s) => [s.id, s.status]));
    expect(by).toEqual({ openai: "robots-disallowed", "hugging-face": "failed", good: "ok" });
    expect(r.itemsNew).toBe(1);
    expect(r.notes.join()).toMatch(/GEMINI_API_KEY is not configured/);
    expect(one("SELECT status FROM news_articles").status).toBe("pending"); // collected, waiting for a summary
    expect(
      one("SELECT robots_status, consecutive_failures FROM news_sources WHERE id = 'openai'"),
    ).toEqual({ robots_status: "disallowed", consecutive_failures: 1 });
    expect(
      one("SELECT consecutive_failures, last_error FROM news_sources WHERE id = 'hugging-face'"),
    ).toEqual({ consecutive_failures: 1, last_error: "feed answered 500" });
    // The disallow is cached: the next run does not fetch OpenAI's feed at all.
    f.calls.length = 0;
    await runIngestion({ db, summarizer: null, trigger: "manual", fetch: both, now });
    expect(f.calls.some((u) => u.includes("openai.com"))).toBe(false);
  });

  it("only one run at a time; a dead run's lock expires", async () => {
    db.raw.exec(
      "INSERT INTO news_runs (id, trigger, status, started_at) VALUES ('r0', 'cron', 'running', '2026-11-01T11:55:00.000Z')",
    );
    const f = feeds();
    const blocked = await runIngestion({ db, summarizer: null, trigger: "cron", fetch: f.fn, now });
    expect(blocked).toMatchObject({ status: "skipped", runId: null });
    expect(f.calls).toHaveLength(0);
    clock = new Date("2026-11-01T12:30:00.000Z"); // 35 minutes later: the old run is abandoned
    const ok = await runIngestion({ db, summarizer: null, trigger: "cron", fetch: f.fn, now });
    expect(ok.runId).not.toBeNull();
    expect(one("SELECT status, error FROM news_runs WHERE id = 'r0'")).toEqual({
      status: "failed",
      error: "abandoned (lock expired)",
    });
  });

  it("free quota used up: items stay pending with no attempt counted, the run stops calling, nothing paid", async () => {
    let calls = 0;
    const f = feeds({
      [GEMINI_URL]: () => {
        calls++;
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "Quota exceeded",
              details: [],
            },
          }),
          { status: 429 },
        );
      },
    });
    const summarizer = createSummarizer({ apiKey: "k", fetch: f.fn });
    const r = await runIngestion({
      db,
      summarizer,
      trigger: "cron",
      fetch: f.fn,
      now,
      config: { maxSummaries: 10 },
    });
    expect(calls).toBe(1); // the first 429 stops the loop
    expect(r).toMatchObject({ published: 0, failed: 0, deferred: 1 });
    expect(r.notes.join()).toMatch(/summaries paused: Gemini free-tier rate limit/);
    // no request ever went anywhere but Gemini (no paid fallback)
    expect(f.calls.filter((u) => /anthropic|openai\.com\/v1|api\./.test(u))).toEqual([]);
    const rows = all("SELECT status, attempts FROM news_articles WHERE status <> 'skipped'");
    expect(rows.every((x: any) => x.status === "pending" && x.attempts === 0)).toBe(true);
    expect(one("SELECT cost_usd FROM news_runs WHERE id = ?", r.runId).cost_usd).toBe(0);
  });

  it("a retryable summary failure stays pending until the attempt limit", async () => {
    const f = feeds({
      [GEMINI_URL]: () => geminiResponse(summaryJson({ summary: "short" })),
    });
    const summarizer = createSummarizer({ apiKey: "k", fetch: f.fn });
    for (let i = 0; i < 3; i++) {
      clock = new Date(clock.getTime() + 3 * 3600_000);
      await runIngestion({
        db,
        summarizer,
        trigger: "cron",
        fetch: f.fn,
        now,
        config: { maxSummaries: 10 },
      });
    }
    const r = one(
      "SELECT status, attempts, last_error FROM news_articles WHERE canonical_url = 'https://openai.com/news/gpt-9'",
    );
    expect(r).toMatchObject({ status: "failed", attempts: 3 });
    expect(r.last_error).toMatch(/summary rejected/);
  });

  it("the public reader shows published rows only, newest first, with category, search, pagination and trending", async () => {
    const f = feeds();
    await runIngestion({
      db,
      summarizer: createSummarizer({ apiKey: "k", fetch: f.fn }),
      trigger: "cron",
      fetch: f.fn,
      now,
      config: { maxSummaries: 10 },
    });
    const reader = createNewsReader(db);
    const page = await reader.list({ page: 1 });
    expect(page.items.map((i) => i.sourceName)).toEqual(["OpenAI", "OpenAI"]);
    expect(page.hasMore).toBe(false);
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      [
        "category",
        "description",
        "featured",
        "imageUrl",
        "publishedAt",
        "slug",
        "sourceName",
        "sourcePublishedAt",
        "title",
      ].sort(),
    );
    expect((await reader.list({ page: 1, q: "Safety" })).items).toHaveLength(1);
    expect((await reader.list({ page: 1, q: "100%_" })).items).toHaveLength(0); // LIKE wildcards are escaped
    expect((await reader.list({ page: 1, category: "research" })).items).toHaveLength(0);
    const trending = await reader.trending(clock);
    expect(trending[0]!.title).toMatch(/GPT-9/); // reported by two sources
    const detail = await reader.item(page.items[0]!.slug);
    expect(detail).toMatchObject({
      takeaways: expect.any(Array),
      sourceSiteUrl: "https://openai.com/news/",
    });
    expect(detail).not.toHaveProperty("source_text");
    const skipped = one("SELECT id FROM news_articles WHERE status = 'skipped'");
    expect(skipped).toBeTruthy();
    // sitemap: /news, one category, the two articles
    const entries = (await contentEntries(db)).map((e) => e.path);
    expect(entries.slice(0, 2)).toEqual(["/news", "/news/category/model-releases"]);
    expect(entries.slice(2).sort()).toEqual(page.items.map((i) => `/news/${i.slug}`).sort());
  });

  it("a database without the news tables reads as no news", async () => {
    const bare = createTestDb({ migrations: false });
    bare.raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
    expect(await createNewsReader(bare).list({ page: 1 })).toEqual({
      items: [],
      page: 1,
      hasMore: false,
    });
    expect(await createNewsReader(bare).item("x")).toBeNull();
  });
});

// ------------------------------------------------------------------ static-site gate
describe("static-site gate and AI News", () => {
  it("classifies news paths and serves them static only while news_version equals the build", () => {
    expect(classify("/news/")).toEqual({ kind: "news", path: "/news" });
    expect(classify("/news/category/research")).toEqual({
      kind: "news",
      path: "/news/category/research",
    });
    expect(classify("/news/some-article")).toEqual({ kind: "news", path: "/news/some-article" });
    expect(classify("/news/category").kind).toBe("pass");
    expect(classify("/news/a/b").kind).toBe("pass");
    const f = {
      unchanged: true,
      contentUnchanged: true,
      affected: new Set(),
    } as unknown as Freshness;
    expect(decide({ kind: "news", path: "/news" }, { ...f, newsUnchanged: true })).toBe("static");
    expect(decide({ kind: "news", path: "/news" }, { ...f, newsUnchanged: false })).toBe("dynamic");
    expect(decide({ kind: "news", path: "/news" }, f)).toBe("dynamic"); // older build without newsVersion
  });

  it("static /news while unchanged; query strings, unbuilt articles and changed news go to the app; scheduled() loads the cron module", async () => {
    const db = createTestDb();
    const assets = new Map<string, string>([
      [
        BUILD_INFO_PATH,
        JSON.stringify({
          buildId: "b",
          snapshotVersion: "",
          snapshotAt: "2026-11-01T00:00:00.000Z",
          contentVersion: "",
          newsVersion: "initial",
        }),
      ],
      ["/news", "STATIC NEWS"],
    ]);
    const ASSETS = {
      fetch: async (input: Request | string) => {
        const body = assets.get(new URL(typeof input === "string" ? input : input.url).pathname);
        return body === undefined ? new Response("", { status: 404 }) : new Response(body);
      },
    };
    const app = {
      fetch: vi.fn(
        async (req: Request) =>
          new Response(`APP ${new URL(req.url).pathname}${new URL(req.url).search}`),
      ),
    };
    const cron = { scheduled: vi.fn(async () => {}) };
    const gate = createGate(app, { cron: async () => cron });
    const get = async (p: string) =>
      (await gate.fetch(new Request(`https://preview.test${p}`), { DB: db, ASSETS }, {})).text();
    expect(await get("/news")).toBe("STATIC NEWS");
    expect(await get("/news?q=claude")).toBe("APP /news?q=claude");
    expect(await get("/news/new-article")).toBe("APP /news/new-article");
    db.raw.exec("UPDATE meta SET value = 'after-run' WHERE key = 'news_version'");
    expect(await get("/news")).toBe("APP /news");
    const ctx = { waitUntil: vi.fn() };
    await gate.scheduled({ cron: "0 */3 * * *" }, { DB: db }, ctx);
    expect(cron.scheduled).toHaveBeenCalledOnce();
  });
});

// ------------------------------------------------------------------ admin API
describe("admin API: AI News", () => {
  const NOW = 1_800_000_000;
  let key!: TestKey;
  let db: TestDb;
  let jwks!: JwksProvider;
  let token = "";
  let tick = 0;
  beforeAll(async () => {
    key = await makeKey("k1");
  });
  beforeEach(async () => {
    db = createTestDb();
    db.raw.exec("UPDATE news_sources SET enabled = 0");
    jwks = staticJwks(key);
    token = await signJwt(key, goodClaims(NOW));
    tick = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    o: { token?: string | null; fetch?: typeof fetch } = {},
  ) => {
    const headers: Record<string, string> = {};
    const t = o.token === undefined ? token : o.token;
    if (t) headers["cf-access-jwt-assertion"] = t;
    if (method !== "GET")
      Object.assign(headers, {
        "x-requested-with": "tryaitools-admin",
        origin: "https://admin.test",
        "content-type": "application/json",
      });
    const res = await handleAdminApi(
      new Request(`https://admin.test/api/admin/${path}`, {
        method,
        headers,
        ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }),
      }),
      {
        env: async () => goodEnv,
        db: async () => db,
        now: () => `2026-11-01T10:00:${String(++tick).padStart(2, "0")}.000Z`,
        auth: { jwks, nowSeconds: NOW },
        newsSummarizer: async () => null,
        ...(o.fetch ? { newsFetch: o.fetch } : {}),
      },
    );
    return { status: res.status, json: (await res.json()) as any };
  };
  const seedArticle = (status: string, extra = "") =>
    db.raw.exec(
      `INSERT INTO news_articles (id, slug, source_id, source_name, canonical_url, title_key, original_title, title, summary,
         card_description, category, status, collected_at, published_at, updated_at${extra ? ", " + extra.split("=")[0] : ""})
       VALUES ('00000000-0000-4000-8000-000000000001', 'a-story-abc123', 'openai', 'OpenAI', 'https://openai.com/x', 'a story',
         'A story', 'A story', 'Summary', 'Card', 'research', '${status}', '2026-11-01T00:00:00.000Z',
         ${status === "published" || status === "unpublished" ? "'2026-11-01T00:00:00.000Z'" : "NULL"}, '2026-11-01T00:00:00.000Z'${extra ? ", " + extra.split("=")[1] : ""})`,
    );
  const ID = "00000000-0000-4000-8000-000000000001";

  it("every news endpoint requires Access first", async () => {
    for (const [m, p] of [
      ["GET", "news/stats"],
      ["GET", "news/sources"],
      ["PUT", "news/sources/openai"],
      ["GET", "news/articles"],
      ["POST", "news/run"],
      ["POST", `news/articles/${ID}/action`],
    ] as const)
      expect((await call(m, p, {}, { token: null })).status, `${m} ${p}`).toBe(401);
  });

  it("stats, sources and toggling a source (with audit and optimistic concurrency)", async () => {
    expect((await call("GET", "news/stats")).json.sources.total).toBe(18);
    const src = (await call("GET", "news/sources")).json.sources.find(
      (s: any) => s.id === "openai",
    );
    expect(src.enabled).toBe(0);
    expect(
      (await call("PUT", "news/sources/openai", { enabled: true, updated_at: src.updated_at }))
        .status,
    ).toBe(200);
    expect(
      db.raw.prepare("SELECT enabled FROM news_sources WHERE id = 'openai'").get().enabled,
    ).toBe(1);
    expect(
      (await call("PUT", "news/sources/openai", { enabled: false, updated_at: src.updated_at }))
        .status,
    ).toBe(409); // stale
    expect(db.raw.prepare("SELECT action FROM audit_events ORDER BY id DESC").get().action).toBe(
      "news_source.update",
    );
    expect(
      (await call("PUT", "news/sources/openai", { feed_url: "https://evil.test", updated_at: "x" }))
        .status,
    ).toBe(422);
  });

  it("feature, unpublish, republish and delete (tombstone) with news_version bumps; invalid transitions are 409", async () => {
    seedArticle("published");
    const v0 = db.raw.prepare("SELECT value FROM meta WHERE key = 'news_version'").get().value;
    const act = async (action: string) => {
      const row = db.raw.prepare("SELECT updated_at FROM news_articles WHERE id = ?").get(ID);
      return call("POST", `news/articles/${ID}/action`, { action, updated_at: row.updated_at });
    };
    expect((await act("feature")).status).toBe(200);
    expect((await act("republish")).status).toBe(409);
    expect((await act("unpublish")).status).toBe(200);
    expect(
      db.raw.prepare("SELECT status, featured FROM news_articles WHERE id = ?").get(ID),
    ).toEqual({ status: "unpublished", featured: 0 });
    expect((await act("republish")).status).toBe(200);
    expect((await act("delete")).status).toBe(200);
    const row = db.raw
      .prepare("SELECT status, slug, title, canonical_url FROM news_articles WHERE id = ?")
      .get(ID);
    expect(row).toEqual({
      status: "deleted",
      slug: null,
      title: null,
      canonical_url: "https://openai.com/x",
    });
    expect(
      db.raw.prepare("SELECT value FROM meta WHERE key = 'news_version'").get().value,
    ).not.toBe(v0);
    expect((await call("GET", `news/articles/${ID}`)).status).toBe(404);
    expect((await call("GET", "news/articles")).json.items).toHaveLength(0);
  });

  it("retry re-queues a failed article and runs the summariser for it at once", async () => {
    seedArticle("failed");
    const row = db.raw.prepare("SELECT updated_at FROM news_articles WHERE id = ?").get(ID);
    const r = await call("POST", `news/articles/${ID}/action`, {
      action: "retry",
      updated_at: row.updated_at,
    });
    expect(r.status).toBe(200);
    expect(r.json.report.notes.join()).toMatch(/not configured/); // no key in this test: re-queued, not summarised
    expect(
      db.raw.prepare("SELECT status, attempts FROM news_articles WHERE id = ?").get(ID),
    ).toEqual({ status: "pending", attempts: 0 });
  });

  it("Run now runs the pipeline and reports; a concurrent run is 409", async () => {
    db.raw.exec("UPDATE news_sources SET enabled = 1 WHERE id = 'openai'");
    const f = fakeFetch({
      "https://openai.com/robots.txt": () => new Response(""),
      "https://openai.com/news/rss.xml": () =>
        new Response(
          // dated yesterday: the fixed fixture date ages past maxAgeDays as the calendar moves on
          rss([
            {
              title: "A brand new model is available",
              link: "https://openai.com/news/n1",
              date: new Date(Date.now() - 86_400_000).toUTCString(),
            },
          ]),
        ),
    });
    const r = await call("POST", "news/run", {}, { fetch: f.fn });
    expect(r.status).toBe(200);
    expect(r.json.report).toMatchObject({ itemsNew: 1, sourcesChecked: 1 });
    db.raw.exec(
      "INSERT INTO news_runs (id, trigger, status, started_at) VALUES ('busy', 'cron', 'running', '2099-01-01T00:00:00.000Z')",
    );
    expect((await call("POST", "news/run", {}, { fetch: f.fn })).status).toBe(409);
    expect((await call("POST", "news/run", { source_ids: ["Bad Id"] })).status).toBe(422);
  });
});

describe("news search pattern", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  it("stays within D1's 50-byte LIKE limit for long, accented and escaped queries", () => {
    expect(likePattern("chat")).toBe("%chat%");
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
    for (const q of [
      "Centre Tecnològic de Telecomunicacions de Catalunya",
      "a".repeat(80),
      "%".repeat(80),
      "ò".repeat(80),
    ]) {
      const p = likePattern(q);
      expect(bytes(p)).toBeLessThanOrEqual(50);
      // Never cuts an escape in half: once every escape pair is removed, no bare \, % or _ is left inside.
      expect(/[\\%_]/.test(p.slice(1, -1).replace(/\\[\\%_]/g, ""))).toBe(false);
    }
  });
});

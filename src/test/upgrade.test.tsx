// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses in tests */
// The UI/navigation/filtering/Learning Hub upgrade: pricing tags and filters (never guessed), Explore/TryAI, category
// icons, navigation sections, the AI Agents page, GA4 footer statistics, tutorials, the Learning Hub sitemap and
// the old /courses URLs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { navSection } from "@/components/site/Layout";
import { ToolCard } from "@/components/site/ToolCard";
import { categoryIconFor } from "@/components/site/CategoryIcon";
import { handleAdminApi } from "@/lib/admin/api";
import { createD1Reader } from "@/lib/catalog/d1-reader";
import { resetVersionedCache } from "@/lib/catalog/versioned-cache";
import { createContentReader } from "@/lib/content/reader";
import { matchesPricing, pricingCounts, pricingOf } from "@/lib/pricing";
import { ga4Config, handleStats, readStats, resetStatsCache } from "@/lib/stats";
import { createGate } from "@/static/gate";
import { contentEntries, FIXED_PAGES } from "@/static/sitemap";
import { LayoutGrid } from "lucide-react";
import { Route as AgentsRoute } from "@/routes/agents";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

afterEach(() => vi.restoreAllMocks());
const tool = (o: Record<string, unknown> = {}) =>
  ({
    slug: "chatgpt",
    name: "ChatGPT",
    url: "https://chat.openai.com",
    category: "AI Writing Tools",
    categorySlug: "ai-writing-tools",
    subcategory: "AI Writing Assistants",
    ...o,
  }) as any;

describe("pricing (recorded, never guessed)", () => {
  it("classifies only the four known values; anything else is 'not recorded'", () => {
    expect(pricingOf("free")).toBe("free");
    expect(pricingOf("free_trial")).toBe("free_trial");
    for (const v of [null, undefined, "", "Free", "FREE", "trial", "open source", 1])
      expect(pricingOf(v), String(v)).toBeNull();
  });

  it("filters and counts: All keeps everything; unrecorded tools count only towards All", () => {
    const models = ["free", "paid", null, "freemium", "free", undefined] as any[];
    expect(pricingCounts(models)).toEqual({ all: 6, free: 2, freemium: 1, free_trial: 0, paid: 1 });
    expect(models.filter((m) => matchesPricing(m, "all"))).toHaveLength(6);
    expect(models.filter((m) => matchesPricing(m, "free"))).toHaveLength(2);
    expect(models.filter((m) => matchesPricing(m, "free_trial"))).toHaveLength(0);
  });

  it("a card shows a pricing tag only when one is recorded", () => {
    const { unmount } = render(<ToolCard tool={tool()} />);
    for (const label of ["Free", "Freemium", "Free Trial", "Paid"])
      expect(screen.queryByText(label)).toBeNull();
    unmount();
    render(<ToolCard tool={tool({ pricing: "free_trial" })} />);
    const tag = screen.getByText("Free Trial");
    expect(tag.getAttribute("data-pricing")).toBe("free_trial");
  });

  it("the D1 reader carries pricing_model to category cards (and omits it when unset)", async () => {
    const db = createTestDb({
      seed: [
        "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('c','ai-writing-tools','AI Writing Tools','[\"Sub\"]',1,'published')",
        "INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,pricing_model) VALUES ('t1','a','A','https://a.example','c','Sub','published','index',0,'freemium')",
        "INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review) VALUES ('t2','b','B','https://b.example','c','Sub','published','index',0)",
      ],
    });
    resetVersionedCache();
    const page = await createD1Reader(db).categoryPage("ai-writing-tools");
    const bySlug = Object.fromEntries(page!.tools.map((t) => [t.slug, t]));
    expect(bySlug["a"]!.pricing).toBe("freemium");
    expect("pricing" in bySlug["b"]!).toBe(false);
    // the database refuses values outside the four
    expect(() => db.raw.exec("UPDATE tools SET pricing_model = 'cheap' WHERE id = 't2'")).toThrow();
  });
});

describe("tool cards: Explore and TryAI", () => {
  it("both buttons share one size and look; the highlight moves to TryAI while it is hovered or focused", () => {
    render(<ToolCard tool={tool()} />);
    const explore = screen.getByRole("link", { name: "Explore" });
    const tryAI = screen.getByRole("link", { name: /^TryAI: open ChatGPT/ });
    expect(explore.getAttribute("href")).toBe("/tools/chatgpt");
    expect(tryAI.getAttribute("href")).toBe("https://chat.openai.com");
    expect(tryAI.getAttribute("target")).toBe("_blank");
    expect(tryAI.getAttribute("rel")).toContain("noopener");
    const css = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");
    // one shared rule for size and default (neutral) look
    expect(css).toContain(".tool-card-cta,\n  .tool-card-try {");
    // highlighted: Explore on card hover/focus, TryAI on its own hover/focus...
    for (const sel of [
      ".tool-card:hover .tool-card-cta",
      ".tool-card:focus-within .tool-card-cta",
      ".tool-card .tool-card-try:hover",
      ".tool-card .tool-card-try:focus-visible",
    ])
      expect(css, sel).toContain(sel);
    // ...and Explore returns to neutral while TryAI has it
    expect(css).toContain(".tool-card:has(.tool-card-try:hover) .tool-card-cta");
    expect(css).toContain(".tool-card:has(.tool-card-try:focus-visible) .tool-card-cta");
  });
});

describe("navigation and icons", () => {
  it("highlights the right section for every route", () => {
    const cases: [string, string | null][] = [
      ["/", "/"],
      ["/tools", "/"],
      ["/tools/chatgpt", "/"],
      ["/categories", "/"],
      ["/categories/ai-video-tools", "/"],
      ["/learn", "/learn"],
      ["/learn/books/x", "/learn"],
      ["/courses/old-link", "/learn"],
      ["/gadgets/x", "/gadgets"],
      ["/guest-articles", "/guest-articles"],
      ["/blog/", "/blog"],
      ["/agents", "/agents"],
      ["/about", null],
      ["/blogger", null],
    ];
    for (const [p, want] of cases) expect(navSection(p), p).toBe(want);
  });

  it("every published category has its own icon (no fallback)", () => {
    const tools = JSON.parse(readFileSync("src/data/tools.json", "utf8")) as any;
    const list = (Array.isArray(tools) ? tools : tools.tools) as { category: string }[];
    const slugs = [...new Set(list.map((t) => t.category))].map((name) =>
      name
        .toLowerCase()
        .replace(/&/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
    expect(slugs.length).toBeGreaterThan(10);
    for (const s of slugs) expect(categoryIconFor(s), s).not.toBe(LayoutGrid);
    expect(categoryIconFor("something-new")).toBe(LayoutGrid);
  });
});

describe("AI Agents page", () => {
  it("is noindex and not in the sitemap", () => {
    const head = (AgentsRoute.options.head as any)();
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, follow" });
    expect(head.links).toEqual([{ rel: "canonical", href: "https://tryaitools.io/agents" }]);
    expect(FIXED_PAGES.some((p) => p.path === "/agents")).toBe(false);
  });
});

describe("footer statistics (GA4, read-only, off until configured)", () => {
  let pkcs8 = "";
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    let bin = "";
    for (const b of der) bin += String.fromCharCode(b);
    pkcs8 = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----\n`;
    publicKey = pair.publicKey;
  });
  let publicKey!: CryptoKey;
  beforeEach(() => resetStatsCache());
  const env = () => ({
    GA4_PROPERTY_ID: "123456789",
    GA4_CLIENT_EMAIL: "stats-reader@tryaitools.iam.gserviceaccount.com",
    // as pasted from the JSON key file: literal \n sequences
    GA4_PRIVATE_KEY: pkcs8.replace(/\n/g, "\\n"),
    GA4_STATS_START_DATE: "2026-01-01",
  });
  const googleFake = (views = "5432", users = "1234") => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === "https://oauth2.googleapis.com/token")
        return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3599 }));
      return new Response(
        JSON.stringify({ rows: [{ metricValues: [{ value: users }, { value: views }] }] }),
      );
    });
    return { fetchFn, calls };
  };

  it("is off (null, no request to Google) unless all GA4 settings are present and valid", async () => {
    const { fetchFn } = googleFake();
    for (const e of [
      {},
      { ...env(), GA4_PROPERTY_ID: "G-5W7XSC7VJN" }, // the measurement ID cannot read reports
      { ...env(), GA4_CLIENT_EMAIL: "someone@gmail.com" },
      { ...env(), GA4_PRIVATE_KEY: "not a key" },
    ]) {
      expect(ga4Config(e)).toBeNull();
      expect(await readStats(e, { fetch: fetchFn, shared: null })).toBeNull();
    }
    expect(fetchFn).not.toHaveBeenCalled();
    const res = await handleStats({});
    expect(await res.json()).toEqual({ stats: null });
  });

  it("reads totalUsers and screenPageViews with a signed, read-only service-account token", async () => {
    const { fetchFn, calls } = googleFake();
    const stats = await readStats(env(), {
      fetch: fetchFn,
      nowMs: 1_800_000_000_000,
      shared: null,
    });
    expect(stats).toEqual({ visitors: 1234, views: 5432, since: "2026-01-01" });
    const token = calls[0]!;
    expect(token.url).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(String(token.init!.body)).get("assertion")!;
    const [h, p, s] = assertion.split(".");
    const dec = (x: string) => JSON.parse(atob(x.replace(/-/g, "+").replace(/_/g, "/")));
    expect(dec(h!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(dec(p!)).toMatchObject({
      iss: "stats-reader@tryaitools.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/analytics.readonly", // read-only
      aud: "https://oauth2.googleapis.com/token",
    });
    const sig = Uint8Array.from(atob(s!.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        sig,
        new TextEncoder().encode(`${h}.${p}`),
      ),
    ).toBe(true);
    const report = calls[1]!;
    expect(report.url).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
    );
    expect((report.init!.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer ya29.test",
    );
    expect(JSON.parse(String(report.init!.body))).toEqual({
      dateRanges: [{ startDate: "2026-01-01", endDate: "today" }],
      metrics: [{ name: "totalUsers" }, { name: "screenPageViews" }],
    });
  });

  it("asks Google at most once an hour per isolate, and keeps the last good totals on failure", async () => {
    const { fetchFn } = googleFake();
    const t0 = 1_800_000_000_000;
    await readStats(env(), { fetch: fetchFn, nowMs: t0, shared: null });
    await readStats(env(), { fetch: fetchFn, nowMs: t0 + 30 * 60_000, shared: null });
    expect(fetchFn).toHaveBeenCalledTimes(2); // token + report, once
    const failing = vi.fn(async () => new Response("quota", { status: 429 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const after = await readStats(env(), { fetch: failing, nowMs: t0 + 61 * 60_000, shared: null });
    expect(after).toEqual({ visitors: 1234, views: 5432, since: "2026-01-01" });
    await readStats(env(), { fetch: failing, nowMs: t0 + 65 * 60_000, shared: null });
    expect(failing).toHaveBeenCalledTimes(1); // waits RETRY_MS before trying again
  });

  it("shows nothing while GA has no page views, and never returns the configuration", async () => {
    const zero = googleFake("0", "0");
    expect(await readStats(env(), { fetch: zero.fetchFn, shared: null })).toBeNull();
    resetStatsCache();
    const { fetchFn } = googleFake();
    await readStats(env(), { fetch: fetchFn, shared: null }); // warm the cache
    const body = await (await handleStats(env())).text();
    expect(JSON.parse(body)).toEqual({
      stats: { visitors: 1234, views: 5432, since: "2026-01-01" },
    });
    for (const secret of ["PRIVATE KEY", "gserviceaccount", "123456789", "ya29"])
      expect(body).not.toContain(secret);
  });

  it("no first-party counting remains: no beacon, no hit endpoint, no D1 table", () => {
    expect(readFileSync("src/lib/analytics.ts", "utf8")).not.toMatch(/api\/hit|tai_counted/);
    expect(existsSync("src/routes/api.hit.ts")).toBe(false);
    for (const f of readdirSync("migrations"))
      expect(readFileSync(`migrations/${f}`, "utf8"), f).not.toContain("site_stats");
  });
});

describe("AI Learning Hub", () => {
  const NOW = 1_800_000_000;
  const ORIGIN = "https://admin.test";
  let key!: TestKey;
  let token = "";
  let db: TestDb;
  let tick = 0;
  beforeAll(async () => {
    key = await makeKey("k1");
  });
  beforeEach(async () => {
    db = createTestDb();
    tick = 0;
    token = await signJwt(key, goodClaims(NOW));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, {
        method,
        headers: {
          "cf-access-jwt-assertion": token,
          ...(method === "GET"
            ? {}
            : {
                "x-requested-with": "tryaitools-admin",
                origin: ORIGIN,
                "content-type": "application/json",
              }),
        },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      {
        env: async () => goodEnv,
        db: async () => db,
        now: () => `2026-11-01T10:00:${String(++tick).padStart(2, "0")}.000Z`,
        auth: { jwks: staticJwks(key), nowSeconds: NOW },
      },
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const BODY = "Step by step, with screenshots and the prompts to use. ".repeat(8);
  const tutorial = (o: Record<string, unknown> = {}) => ({
    client_id: "00000000-0000-4000-8000-000000000101",
    slug: "first-agent",
    title: "Build your first agent",
    author_or_provider: "TryAITools",
    summary: "A short walkthrough.",
    body_md: "",
    difficulty: "beginner",
    format: "Article",
    duration: "20 min",
    resource_url: null,
    is_affiliate: false,
    is_free: true,
    topics: ["Agents"],
    featured: false,
    sort_order: 0,
    indexing: "noindex",
    ...o,
  });
  const publish = async (section: string, slug: string, updated_at: string) =>
    call("POST", `${section}/${slug}/action`, { action: "publish", updated_at });

  it("tutorials: admin CRUD with a real-content rule, then public pages, related links and the sitemap", async () => {
    const empty = await call("POST", "tutorials", tutorial());
    expect(empty.status).toBe(201);
    expect((await publish("tutorials", "first-agent", empty.json.item.updated_at)).status).toBe(
      422,
    ); // nothing to read
    expect((await call("POST", "tutorials", tutorial({ is_affiliate: true }))).status).toBe(422); // no link
    expect(
      (
        await call(
          "POST",
          "tutorials",
          tutorial({
            client_id: "00000000-0000-4000-8000-000000000102",
            slug: "thin",
            indexing: "index",
          }),
        )
      ).status,
    ).toBe(422); // thin pages are not indexable
    const { client_id: _c, slug: _s, ...edit } = tutorial({ body_md: BODY, indexing: "index" });
    const full = await call("PUT", "tutorials/first-agent", {
      ...edit,
      updated_at: empty.json.item.updated_at,
    });
    expect(full.status).toBe(200);
    expect((await publish("tutorials", "first-agent", full.json.item.updated_at)).status).toBe(200);
    const link = await call(
      "POST",
      "tutorials",
      tutorial({
        client_id: "00000000-0000-4000-8000-000000000103",
        slug: "link-only",
        resource_url: "https://learn.example.com/t",
      }),
    );
    expect((await publish("tutorials", "link-only", link.json.item.updated_at)).status).toBe(200); // a link is enough

    const r = createContentReader(db);
    expect((await r.list("tutorials")).map((t) => t.slug).sort()).toEqual([
      "first-agent",
      "link-only",
    ]);
    expect((await r.related("tutorials", "first-agent")).map((t) => t.slug)).toEqual(["link-only"]);
    const paths = (await contentEntries(db)).map((e) => e.path);
    // link-only is noindex (no content here), so it is a page but not a sitemap entry
    expect(paths).toEqual(["/learn", "/learn/tutorials", "/learn/tutorials/first-agent"]);
  });

  it("courses and books share the courses table but get their own sections and URLs", async () => {
    const base = {
      kind: "book",
      title: "AI Basics",
      provider_or_author: "A. Author",
      summary: "An introduction.",
      review_md: "Why we like it. ".repeat(25),
      level: "all",
      is_free: false,
      affiliate_url: "https://books.example.com/ai?tag=tai",
      topics: [],
      featured: false,
      sort_order: 0,
      indexing: "index",
    };
    const b = await call("POST", "courses", {
      client_id: "00000000-0000-4000-8000-000000000201",
      slug: "ai-basics",
      ...base,
    });
    await publish("courses", "ai-basics", b.json.item.updated_at);
    const c = await call("POST", "courses", {
      client_id: "00000000-0000-4000-8000-000000000202",
      slug: "prompting",
      ...base,
      kind: "course",
      title: "Prompting",
    });
    await publish("courses", "prompting", c.json.item.updated_at);
    expect((await contentEntries(db)).map((e) => e.path)).toEqual([
      "/learn",
      "/learn/courses",
      "/learn/courses/prompting",
      "/learn/books",
      "/learn/books/ai-basics",
    ]);
    // related links stay within the same kind
    const r = createContentReader(db);
    expect(await r.related("courses", "prompting", { kind: "course" })).toEqual([]);
    expect((await r.related("courses", "prompting", { kind: "book" })).map((x) => x.slug)).toEqual([
      "ai-basics",
    ]);
  });

  it("old /courses URLs redirect permanently by kind, without the app; unknown ones are a 404", async () => {
    const app = { fetch: vi.fn(async () => new Response("app")) };
    const gate = createGate(app as any);
    const assets = {
      fetch: async (req: Request | string) => {
        const u = new URL(typeof req === "string" ? req : req.url);
        return u.pathname === "/_static/build.json"
          ? new Response(
              JSON.stringify({ buildId: "b", snapshotVersion: "v", snapshotAt: "2026-01-01" }),
            )
          : new Response("", { status: 404 });
      },
    };
    const DB = createTestDb({
      seed: [
        "INSERT INTO courses (id,slug,kind,title,status,published_at) VALUES ('c1','a-book','book','A','published','2026-01-01')",
        "INSERT INTO courses (id,slug,kind,title,status,published_at) VALUES ('c2','a-course','course','B','published','2026-01-01')",
        "INSERT INTO courses (id,slug,kind,title,status) VALUES ('c3','a-draft','course','C','draft')",
      ],
    });
    const env = { DB, ASSETS: assets };
    const go = async (p: string) => gate.fetch(new Request(`https://tryaitools.io${p}`), env, {});
    const list = await go("/courses?ref=x");
    expect(list.status).toBe(301);
    expect(list.headers.get("location")).toBe("/learn/courses?ref=x");
    expect((await go("/courses/a-book")).headers.get("location")).toBe("/learn/books/a-book");
    expect((await go("/courses/a-course/")).headers.get("location")).toBe(
      "/learn/courses/a-course",
    );
    expect((await go("/courses/a-draft")).status).toBe(404); // unpublished entries are not revealed
    expect((await go("/courses/nope")).status).toBe(404);
    expect(app.fetch).not.toHaveBeenCalled();
  });
});

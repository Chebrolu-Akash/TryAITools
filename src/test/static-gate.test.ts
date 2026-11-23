// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed rows and JSON in tests */
// The static-site gate must never let a pre-built page show something that is no longer public, and must keep serving
// static HTML for everything that is unchanged.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi } from "@/lib/admin/api";
import { createD1Reader } from "@/lib/catalog/d1-reader";
import { resetVersionedCache } from "@/lib/catalog/versioned-cache";
import { normalizeToolsQuery } from "@/lib/catalog/views";
import { getReader } from "@/lib/catalog/reader";
import { Route as RootRoute } from "@/routes/__root";
import { Route as SearchRoute } from "@/routes/api.search";
import { Route as CategoryRoute } from "@/routes/categories.$slug";
import { routeTree } from "@/routeTree.gen";
import { classify, decide, type Freshness } from "@/static/freshness";
import {
  BUILD_INFO_PATH,
  createGate,
  FAIL_OPEN_WINDOW_MS,
  REDIRECTS_PATH,
  refsPath,
} from "@/static/gate";
import { SEARCH_INDEX_PATH, searchIndexFromDb } from "@/static/search";
import {
  isSitemapPath,
  SITEMAP_DATA_PATH,
  sitemapFiles,
  sitemapFromDb,
  type SitemapEntry,
} from "@/static/sitemap";
import { SITE_URL } from "@/lib/site";
import { goodClaims, goodEnv, makeKey, signJwt, staticJwks } from "./helpers/access-jwt";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";
import { passGate } from "./helpers/gate-fixture";

const empty = (): Freshness => ({
  version: "v",
  unchanged: false,
  contentUnchanged: false,
  hiddenTools: new Set(),
  changedTools: new Set(),
  hiddenCategories: new Set(),
  changedCategories: new Set(),
  affected: new Set(),
});

describe("page classification and decisions", () => {
  it("classifies public pages and passes everything else to the app", () => {
    expect(classify("/tools/chatgpt")).toEqual({
      kind: "tool",
      slug: "chatgpt",
      path: "/tools/chatgpt",
    });
    expect(classify("/tools/chatgpt/")).toEqual({
      kind: "tool",
      slug: "chatgpt",
      path: "/tools/chatgpt",
    });
    expect(classify("/categories/ai-video-tools")).toMatchObject({
      kind: "category",
      slug: "ai-video-tools",
    });
    for (const p of ["/", "/tools", "/categories", "/about", "/tools/"])
      expect(classify(p).kind, p).toBe("page");
    for (const p of [
      "/tools/chatgpt.html",
      "/index.html",
      "/admin",
      "/api/admin/stats",
      "/_serverFn/x",
      "/tools/Bad_Slug",
      "/tools/a/b",
      "/_static/build.json",
      "/sitemap.xml", // answered by the gate itself, not as a pre-built page
    ])
      expect(classify(p).kind, p).toBe("pass");
    for (const p of ["/sitemap.xml", "/sitemaps/1.xml", "/sitemaps/12.xml"])
      expect(isSitemapPath(p), p).toBe(true);
    for (const p of ["/sitemaps/0.xml", "/sitemaps/x.xml", "/sitemap.xml/", "/sitemaps/1.xml.html"])
      expect(isSitemapPath(p), p).toBe(false);
  });

  it("decides 404 for hidden tools and categories, fresh rendering for changed or affected pages, else static", () => {
    const f = empty();
    f.hiddenTools.add("gone");
    f.changedTools.add("edited");
    f.hiddenCategories.add("drafted");
    f.affected.add("/categories/ai-writing-tools");
    const page = (p: string) =>
      classify(p) as Exclude<ReturnType<typeof classify>, { kind: "pass" }>;
    expect(decide(page("/tools/gone"), f)).toBe("not-found");
    expect(decide(page("/tools/edited"), f)).toBe("dynamic");
    expect(decide(page("/categories/drafted"), f)).toBe("not-found");
    expect(decide(page("/categories/ai-writing-tools"), f)).toBe("dynamic");
    expect(decide(page("/tools/other"), f)).toBe("static");
    expect(decide(page("/"), f)).toBe("static");
    expect(decide(page("/tools/gone"), { ...f, unchanged: true })).toBe("static");
  });
});

describe("gate against D1 and the Admin API", () => {
  let importSql: string[] = [];
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tryai-gate-"));
    const r = spawnSync(
      process.execPath,
      ["scripts/db/build-import.mjs", "--env", "local", "--out", dir],
      {
        encoding: "utf8",
      },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    importSql = report.generatedFiles.map((f: string) => readFileSync(join(dir, f), "utf8"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  let db: TestDb;
  let snapshotVersion = "";
  let snapshotAt = "";
  /** A fake asset store: the static pages that exist, build.json and the reverse index, as the build writes them. */
  let assets: Map<string, string>;
  const STATIC = [
    "/",
    "/tools",
    "/categories",
    "/about",
    "/tools/chatgpt",
    "/tools/claude",
    "/tools/figma",
    "/tools/semrush",
    "/categories/ai-writing-tools",
    "/categories/ai-seo-tools",
  ];
  const ASSETS = {
    fetch: async (input: Request | string) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname;
      const body = assets.get(path);
      return body === undefined
        ? new Response("", { status: 404 })
        : new Response(body, { status: 200, headers: { etag: `"${path}"` } });
    },
  };
  const app = {
    fetch: vi.fn(async (req: Request) => new Response(`APP ${new URL(req.url).pathname}`)),
  };
  let clock = 1_000_000;
  let gate: ReturnType<typeof createGate>;
  const env = () => ({ DB: db, ASSETS });
  const get = async (path: string) => {
    const res = await gate.fetch(new Request(`https://preview.test${path}`), env(), {});
    const text = await res.text();
    const how =
      res.status === 404
        ? "404"
        : res.status === 503
          ? "503"
          : text.startsWith("APP")
            ? "dynamic"
            : "static";
    return { how, status: res.status, text, res };
  };

  // ---------------------------------------------------------------- the Admin API, exactly as the dashboard calls it
  let tick = 0;
  let admin: (
    method: string,
    path: string,
    body?: unknown,
    host?: string,
  ) => Promise<{ status: number; json: any }>;
  beforeAll(async () => {
    const key = await makeKey("k1");
    const token = await signJwt(key, goodClaims(1_800_000_000));
    admin = async (method, path, body, host = "admin.test") => {
      const res = await handleAdminApi(
        new Request(`https://${host}/api/admin/${path}`, {
          method,
          body: body === undefined ? null : JSON.stringify(body),
          headers: {
            "cf-access-jwt-assertion": token,
            ...(method === "GET"
              ? {}
              : {
                  "x-requested-with": "tryaitools-admin",
                  origin: `https://${host}`,
                  "content-type": "application/json",
                }),
          } as Record<string, string>,
        }),
        {
          env: async () => goodEnv,
          db: async () => db,
          now: () => new Date(Date.UTC(2099, 0, 1) + ++tick * 1000).toISOString(), // after the snapshot
          auth: { jwks: staticJwks(key), nowSeconds: 1_800_000_000 },
        },
      );
      return { status: res.status, json: await res.json() };
    };
  });
  const act = async (slug: string, action: string) => {
    const t = (await admin("GET", `tools/${slug}`)).json.tool;
    return (await admin("POST", `tools/${slug}/action`, { action, updated_at: t.updated_at }))
      .status;
  };
  const setCategory = async (slug: string, status: string) => {
    const c = (await admin("GET", "categories")).json.items.find((x: any) => x.slug === slug);
    const {
      id: _i,
      slug: _s,
      tool_count: _t,
      active_tool_count: _a,
      subcategory_counts: _sc,
      created_at: _c,
      icon: _ic,
      ...rest
    } = c;
    return (await admin("PUT", `categories/${slug}`, { ...rest, status })).status;
  };

  let baseEntries: SitemapEntry[] = [];
  beforeEach(async () => {
    db = createTestDb();
    for (const sql of importSql) db.raw.exec(sql);
    resetVersionedCache();
    snapshotVersion = db.raw
      .prepare("SELECT value FROM meta WHERE key = 'catalog_version'")
      .get().value;
    snapshotAt = "2026-12-31T00:00:00.000Z"; // everything imported is older; admin writes in the test are newer
    db.raw.exec(`UPDATE tools SET updated_at = '2026-01-01T00:00:00.000Z'`);
    db.raw.exec(`UPDATE categories SET updated_at = '2026-01-01T00:00:00.000Z'`);
    assets = new Map(STATIC.map((p) => [p, `STATIC ${p}`]));
    assets.set("/404", "STATIC not found page");
    assets.set(BUILD_INFO_PATH, JSON.stringify({ buildId: "b1", snapshotVersion, snapshotAt }));
    // chatgpt is linked from the home page, /tools, the writing category and claude's page; semrush from the SEO category.
    assets.set(
      refsPath("tool", "chatgpt"),
      JSON.stringify(["/", "/categories/ai-writing-tools", "/tools", "/tools/claude"]),
    );
    assets.set(refsPath("tool", "semrush"), JSON.stringify(["/categories/ai-seo-tools"]));
    assets.set(
      refsPath("category", "ai-seo-tools"),
      JSON.stringify(["/", "/about", "/categories", "/tools/semrush"]),
    );
    // What the build writes from the same snapshot: the search index and the sitemap (entries + XML).
    assets.set(SEARCH_INDEX_PATH, JSON.stringify(await searchIndexFromDb(db)));
    assets.set(REDIRECTS_PATH, JSON.stringify({ "claude-old": "claude" })); // redirects that existed at build time
    baseEntries = await sitemapFromDb(db);
    assets.set(SITEMAP_DATA_PATH, JSON.stringify({ snapshotAt, entries: baseEntries }));
    for (const [p, body] of sitemapFiles(baseEntries, SITE_URL)) assets.set(p, body);
    clock = 1_000_000;
    app.fetch.mockClear();
    gate = createGate(app, { now: () => clock });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("serves static HTML while nothing has changed since the build, and never exposes build files or .html paths", async () => {
    for (const p of ["/", "/tools", "/tools/chatgpt", "/categories/ai-writing-tools", "/about"])
      expect((await get(p)).how, p).toBe("static");
    const r = await get("/tools/chatgpt");
    expect(r.res.headers.get("content-security-policy")).toBeTruthy();
    expect(r.res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect((await get("/_static/build.json")).how).toBe("404");
    expect((await get(refsPath("tool", "chatgpt"))).how).toBe("404");
    // unknown paths get the static 404 page without the app (no React render, no D1 read)
    for (const p of ["/tools/chatgpt.html", "/wp-login.php", "/index.html", "/%61dmin"]) {
      const r = await get(p);
      expect([r.how, r.text], p).toEqual(["404", "STATIC not found page"]);
    }
    expect(
      (
        await gate.fetch(
          new Request("https://preview.test/xmlrpc.php", { method: "POST" }),
          env(),
          {},
        )
      ).status,
    ).toBe(404);
    expect(app.fetch).not.toHaveBeenCalled();
    for (const p of ["/admin", "/Admin/tools", "/api/admin/session", "/_serverFn/abc"])
      expect((await get(p)).how, p).toBe("dynamic"); // these the app must answer (behind Access)
    // not pre-built while the catalogue equals the build: does not exist (static 404, no app)
    expect((await get("/tools/brand-new")).how).toBe("404");
    expect((await get("/categories/no-such-category")).how).toBe("404");
  });

  it("unpublish: the tool's page is 404 at once; pages that list it render fresh; others stay static; republish restores", async () => {
    expect(await act("chatgpt", "unpublish")).toBe(200);
    expect((await get("/tools/chatgpt")).how).toBe("404");
    expect((await get("/tools/chatgpt")).text).toBe("STATIC not found page");
    for (const p of ["/", "/categories/ai-writing-tools", "/tools", "/tools/claude"])
      expect((await get(p)).how, p).toBe("dynamic");
    for (const p of ["/tools/figma", "/about", "/categories/ai-seo-tools"])
      expect((await get(p)).how, p).toBe("static");
    expect(await act("chatgpt", "publish")).toBe(200);
    expect((await get("/tools/chatgpt")).how).toBe("dynamic"); // changed since the build: rendered fresh
    expect((await get("/categories/ai-writing-tools")).how).toBe("static");
  });

  it("flag and unflag behave like unpublish and publish; search never returns a flagged tool", async () => {
    expect(await act("chatgpt", "flag_needs_review")).toBe(200);
    expect((await get("/tools/chatgpt")).how).toBe("404");
    expect((await get("/tools/claude")).how).toBe("dynamic");
    const search = JSON.parse((await get("/api/search?q=chatgpt")).text);
    expect(search.items.map((i: any) => i.slug)).not.toContain("chatgpt");
    expect(await act("chatgpt", "clear_needs_review")).toBe(200);
    expect((await get("/tools/chatgpt")).how).toBe("404"); // flagging a published tool moved it back to draft
    expect(await act("chatgpt", "publish")).toBe(200);
    expect((await get("/tools/chatgpt")).how).toBe("dynamic");
  });

  it("archive and delete: 404, and pages that listed the tool render fresh even after the row is gone", async () => {
    expect(await act("chatgpt", "archive")).toBe(200);
    const t = (await admin("GET", "tools/chatgpt")).json.tool;
    expect(
      (await admin("DELETE", "tools/chatgpt", { updated_at: t.updated_at, confirm: "chatgpt" }))
        .status,
    ).toBe(200);
    expect((await get("/tools/chatgpt")).how).toBe("404");
    expect((await get("/tools/claude")).how).toBe("dynamic");
  });

  it("edits and new tools are rendered fresh; drafts stay 404", async () => {
    const t = (await admin("GET", "tools/figma")).json.tool;
    expect(
      (await admin("PUT", "tools/figma", { ...pickEditable(t), tagline: "Edited" })).status,
    ).toBe(200);
    expect((await get("/tools/figma")).how).toBe("dynamic");
    const created = await admin("POST", "tools", {
      client_id: "00000000-0000-4000-8000-000000000777",
      slug: "fresh-tool",
      name: "Fresh Tool",
      url: "https://fresh.example.com",
      category_id: "ai-writing-tools",
      indexing: "noindex",
      tags: [],
    });
    expect(created.status).toBe(201);
    expect((await get("/tools/fresh-tool")).how).toBe("404"); // a draft
    expect(await act("fresh-tool", "publish")).toBe(200);
    expect((await get("/tools/fresh-tool")).how).toBe("dynamic");
  });

  it("drafting a category: its page and its tools are 404; every page that links to it renders fresh", async () => {
    expect(await setCategory("ai-seo-tools", "draft")).toBe(200);
    expect((await get("/categories/ai-seo-tools")).how).toBe("404");
    expect((await get("/tools/semrush")).how).toBe("404");
    for (const p of ["/", "/about", "/categories"]) expect((await get(p)).how, p).toBe("dynamic");
    expect((await get("/tools/figma")).how).toBe("static");
    expect(await setCategory("ai-seo-tools", "published")).toBe(200);
    // the category was edited since the build, so its own page renders fresh until the next build; its tools are static
    expect((await get("/categories/ai-seo-tools")).how).toBe("dynamic");
    expect((await get("/tools/semrush")).how).toBe("static");
  });

  // ---------------------------------------------------------------- category edits (indexing, name, description)
  const editCategory = async (slug: string, patch: Record<string, unknown>) => {
    const c = (await admin("GET", "categories")).json.items.find((x: any) => x.slug === slug);
    const {
      id: _i,
      slug: _s,
      tool_count: _t,
      active_tool_count: _a,
      subcategory_counts: _sc,
      created_at: _c,
      icon: _ic,
      ...rest
    } = c;
    return (await admin("PUT", `categories/${slug}`, { ...rest, ...patch })).status;
  };
  const categoryHead = async (slug: string) => {
    resetVersionedCache();
    const data = await createD1Reader(db).categoryPage(slug);
    return (CategoryRoute.options.head as (ctx: unknown) => { meta: any[]; links: any[] })({
      loaderData: data,
      params: { slug },
    });
  };
  const robotsOf = (h: { meta: any[] }) =>
    h.meta.filter((m) => m["name"] === "robots").map((m) => m["content"]);
  const CANONICAL = [
    { rel: "canonical", href: "https://tryaitools.io/categories/ai-writing-tools" },
  ];

  it("category index -> noindex: its page renders fresh with robots noindex (same canonical) and leaves the sitemap", async () => {
    expect((await get("/categories/ai-writing-tools")).how).toBe("static");
    expect(await editCategory("ai-writing-tools", { indexing: "noindex" })).toBe(200);
    expect((await get("/categories/ai-writing-tools")).how).toBe("dynamic"); // never the stale indexable HTML
    const h = await categoryHead("ai-writing-tools");
    expect(robotsOf(h)).toEqual(["noindex, follow"]);
    expect(h.links).toEqual(CANONICAL);
    const s = await sitemap();
    expect(s.urls.has("/categories/ai-writing-tools")).toBe(false);
    // tool eligibility is unchanged: its indexable tools stay listed, and their pages stay static
    expect(toolUrls(s.urls)).toEqual(listed());
    expect((await get("/tools/claude")).how).toBe("static");
    // other categories and pages are untouched
    expect((await get("/categories/ai-seo-tools")).how).toBe("static");
    expect((await get("/about")).how).toBe("static");
  });

  it("category noindex -> index again: the fresh page is indexable again and returns to the sitemap", async () => {
    expect(await editCategory("ai-writing-tools", { indexing: "noindex" })).toBe(200);
    expect(await editCategory("ai-writing-tools", { indexing: "index" })).toBe(200);
    expect((await get("/categories/ai-writing-tools")).how).toBe("dynamic");
    const h = await categoryHead("ai-writing-tools");
    expect(robotsOf(h)).toEqual([]);
    expect(h.links).toEqual(CANONICAL);
    expect((await sitemap()).urls.has("/categories/ai-writing-tools")).toBe(true);
  });

  it("a category name or description edit is never served from the stale pre-built page", async () => {
    expect(
      await editCategory("ai-writing-tools", {
        name: "AI Writing Tools (edited)",
        description: "A new description.",
      }),
    ).toBe(200);
    expect((await get("/categories/ai-writing-tools")).how).toBe("dynamic");
    resetVersionedCache();
    const page = (await createD1Reader(db).categoryPage("ai-writing-tools"))!;
    expect(page.category.name).toBe("AI Writing Tools (edited)");
    expect(page.indexable).toBe(true);
    expect((await categoryHead("ai-writing-tools")).links).toEqual(CANONICAL);
    expect((await get("/categories/ai-seo-tools")).how).toBe("static");
    expect(toolUrls((await sitemap()).urls)).toEqual(listed());
  });

  it("fails closed when D1 cannot be read: 503 unless this isolate verified the catalogue within the last minute", async () => {
    const prepare = db.prepare.bind(db);
    const down = () =>
      vi.spyOn(db, "prepare").mockImplementation(() => {
        throw new Error("D1 down");
      });
    let spy = down();
    expect((await get("/tools/chatgpt")).how).toBe("503"); // never verified: no static HTML
    spy.mockRestore();
    expect((await get("/tools/chatgpt")).how).toBe("static");
    spy = down();
    clock += FAIL_OPEN_WINDOW_MS - 1;
    expect((await get("/tools/chatgpt")).how).toBe("static"); // verified moments ago
    clock += 2;
    expect((await get("/tools/chatgpt")).how).toBe("503");
    spy.mockRestore();
    void prepare;
  });

  it("race: a slow check for an older version never overrides a newer one that hid a tool", async () => {
    await act("figma", "archive"); // version V1 (something changed: freshness must be computed)
    // Hold the first change computation (for V1) until the test releases it.
    const prepare = db.prepare.bind(db);
    let release!: () => void;
    const gateOpen = new Promise<void>((r) => (release = r));
    let held = false;
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      const st: any = prepare(sql);
      if (held || !/AND t\.updated_at > \?/.test(sql)) return st;
      held = true;
      const bind = st.bind;
      return {
        ...st,
        bind: (...p: unknown[]) => {
          const b = bind(...p);
          return {
            ...b,
            all: async () => {
              const r = b.all();
              await gateOpen;
              return r;
            },
          };
        },
      };
    });
    const slow = get("/tools/chatgpt"); // reads V1, computation held
    await new Promise((r) => setTimeout(r, 5));
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await act("chatgpt", "unpublish")).toBe(200); // V2: chatgpt hidden
    expect((await get("/tools/chatgpt")).how).toBe("404"); // computed for V2
    release();
    await slow;
    // Where the stored state matters: if D1 is unreachable right now, the gate falls back to the state it stored last.
    // That must be V2's (chatgpt hidden), not the late V1 result.
    const down = vi.spyOn(db, "prepare").mockImplementation(() => {
      throw new Error("D1 down");
    });
    expect((await get("/tools/chatgpt")).how).toBe("404");
    down.mockRestore();
    expect((await get("/tools/chatgpt")).how).toBe("404");
  });

  it("without a static build the gate passes every page to the app (as before)", async () => {
    assets.delete(BUILD_INFO_PATH);
    gate = createGate(app, { now: () => clock });
    expect((await get("/tools/chatgpt")).how).toBe("dynamic");
  });

  // ---------------------------------------------------------------- sitemap
  const sitemap = async (path = "/sitemap.xml") => {
    const r = await get(path);
    expect(r.status, r.text).toBe(200);
    expect(r.res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(r.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset ')).toBe(true);
    expect(r.text.trimEnd().endsWith("</urlset>")).toBe(true);
    const locs = [...r.text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
    for (const l of locs) expect(l.startsWith(`${SITE_URL}/`), l).toBe(true);
    expect(r.text.match(/<url>/g)?.length).toBe(locs.length);
    const paths = locs.map((l) => l.slice(SITE_URL.length));
    expect(new Set(paths).size, "no duplicate URLs").toBe(paths.length);
    const lastmod = new Map<string, string>();
    for (const m of r.text.matchAll(
      /<loc>https:\/\/tryaitools\.io([^<]*)<\/loc>\n {4}<lastmod>([^<]*)<\/lastmod>/g,
    )) {
      expect(Number.isNaN(Date.parse(m[2]!)), m[2]).toBe(false);
      lastmod.set(m[1]!, m[2]!);
    }
    return { urls: new Set(paths), lastmod, text: r.text };
  };
  const baseMod = (p: string) => baseEntries.find((e) => e.path === p)?.lastmod;
  const listed = () =>
    db.raw
      .prepare(
        `SELECT t.slug FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.status = 'published'
           AND t.needs_review = 0 AND c.status = 'published' AND t.indexing = 'index'`,
      )
      .all()
      .map((r: any) => `/tools/${r.slug}`)
      .sort();
  const toolUrls = (urls: Set<string>) => [...urls].filter((u) => u.startsWith("/tools/")).sort();
  const reindex = async (slug: string) => {
    const t = (await admin("GET", `tools/${slug}`)).json.tool;
    const r = await admin("PUT", `tools/${slug}`, { ...pickEditable(t), indexing: "index" });
    return r.status;
  };
  const quota = () =>
    new Error(
      "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
    );

  it("sitemap: the pre-built XML while nothing changed; only published, indexable pages; valid lastmod", async () => {
    const s = await sitemap();
    expect(s.text).toBe(assets.get("/sitemap.xml"));
    expect(toolUrls(s.urls)).toEqual(listed()); // the indexing = 'index' rule, not every public tool
    expect(toolUrls(s.urls).length).toBeLessThan(100);
    for (const p of ["/", "/tools", "/categories", "/about", "/tools/claude", "/tools/figma"])
      expect(s.urls.has(p), p).toBe(true);
    const noindex = (
      db.raw
        .prepare(
          "SELECT slug FROM tools WHERE status = 'published' AND needs_review = 0 AND indexing = 'noindex' LIMIT 1",
        )
        .get() as any
    ).slug;
    expect(s.urls.has(`/tools/${noindex}`), noindex).toBe(false); // public but noindex
    expect(s.urls.has("/categories/ai-writing-tools")).toBe(true);
    expect(s.lastmod.get("/tools/claude")).toBeTruthy();
    expect(s.lastmod.has("/privacy")).toBe(false); // not in D1: no invented date
    expect(app.fetch).not.toHaveBeenCalled();
    expect((await get("/sitemaps/1.xml")).status).toBe(404); // no index needed at this size
  });

  it("sitemap: unpublish, flag/unflag, archive and delete remove the URL; republishing restores it", async () => {
    expect(await act("claude", "unpublish")).toBe(200);
    expect((await sitemap()).urls.has("/tools/claude")).toBe(false);
    expect(await act("claude", "publish")).toBe(200);
    let s = await sitemap();
    // Admin rule: unpublishing also set it to noindex, so it is public again but not listed until re-indexed
    expect(s.urls.has("/tools/claude")).toBe(false);
    expect(toolUrls(s.urls)).toEqual(listed());
    // publish/unpublish changed the category page (its list), not the tool page
    expect(s.lastmod.get("/categories/ai-writing-tools")!.startsWith("2099-")).toBe(true);
    // Re-indexing now goes through the full gate (G1–G10): a legacy curated listing must pass a review first
    expect(await reindex("claude")).toBe(422);
    passGate(db.raw, "claude", "2099-01-01T00:00:00.000Z");
    expect(await reindex("claude")).toBe(200);
    s = await sitemap();
    expect(s.urls.has("/tools/claude")).toBe(true);

    expect(await act("figma", "flag_needs_review")).toBe(200);
    expect((await sitemap()).urls.has("/tools/figma")).toBe(false);
    expect(await act("figma", "clear_needs_review")).toBe(200);
    expect((await sitemap()).urls.has("/tools/figma")).toBe(false); // flagging moved it back to draft
    expect(await act("figma", "publish")).toBe(200);
    passGate(db.raw, "figma", "2099-01-01T00:00:00.000Z");
    expect(await reindex("figma")).toBe(200);
    expect((await sitemap()).urls.has("/tools/figma")).toBe(true);

    expect(await act("canva", "archive")).toBe(200);
    const t = (await admin("GET", "tools/canva")).json.tool;
    expect(
      (await admin("DELETE", "tools/canva", { updated_at: t.updated_at, confirm: "canva" })).status,
    ).toBe(200);
    expect(db.raw.prepare("SELECT 1 FROM tools WHERE slug = 'canva'").get()).toBeUndefined();
    s = await sitemap();
    expect(s.urls.has("/tools/canva")).toBe(false); // removed although its row no longer exists
    expect(toolUrls(s.urls)).toEqual(listed());
  });

  it("sitemap: a newly published indexable tool is added with the time it went live; a noindex one is not", async () => {
    for (const [slug, n] of [
      ["fresh-tool", 1],
      ["quiet-tool", 2],
    ] as const) {
      const created = await admin("POST", "tools", {
        client_id: `00000000-0000-4000-8000-00000000077${n}`,
        slug,
        name: slug,
        url: `https://${slug}.example.com`,
        category_id: "ai-writing-tools",
        indexing: "noindex", // Admin rule: only published tools can be set to index
        tags: [],
      });
      expect(created.status).toBe(201);
      expect((await sitemap()).urls.has(`/tools/${slug}`)).toBe(false); // still a draft
      expect(await act(slug, "publish")).toBe(200);
    }
    expect((await sitemap()).urls.has("/tools/fresh-tool")).toBe(false); // published, but noindex
    expect(await reindex("fresh-tool")).toBe(422); // no reviewed content: the gate refuses
    expect((await sitemap()).urls.has("/tools/fresh-tool")).toBe(false);
    passGate(db.raw, "fresh-tool", "2099-01-01T00:00:00.000Z");
    expect(await reindex("fresh-tool")).toBe(200);
    const s = await sitemap();
    expect(s.urls.has("/tools/fresh-tool")).toBe(true);
    expect(s.lastmod.get("/tools/fresh-tool")!.startsWith("2099-")).toBe(true);
    expect(s.urls.has("/tools/quiet-tool")).toBe(false);
    expect(toolUrls(s.urls)).toEqual(listed());
  });

  it("sitemap: editing a tool moves lastmod for it, its category and the listings, and nothing else", async () => {
    const t = (await admin("GET", "tools/figma")).json.tool;
    expect(
      (await admin("PUT", "tools/figma", { ...pickEditable(t), tagline: "Edited" })).status,
    ).toBe(200);
    const s = await sitemap();
    for (const p of ["/tools/figma", "/categories/ai-design-ui-ux-tools", "/", "/tools"])
      expect(s.lastmod.get(p)!.startsWith("2099-"), p).toBe(true);
    for (const p of ["/tools/claude", "/categories/ai-writing-tools"])
      expect(s.lastmod.get(p), p).toBe(baseMod(p));
  });

  it("sitemap: drafting a category removes it and its tools; publishing it restores both", async () => {
    expect(await setCategory("ai-writing-tools", "draft")).toBe(200);
    let s = await sitemap();
    expect(s.urls.has("/categories/ai-writing-tools")).toBe(false);
    expect(s.urls.has("/tools/claude")).toBe(false);
    expect(toolUrls(s.urls)).toEqual(listed());
    expect(await setCategory("ai-writing-tools", "published")).toBe(200);
    s = await sitemap();
    expect(s.urls.has("/categories/ai-writing-tools")).toBe(true);
    expect(s.urls.has("/tools/claude")).toBe(true);
    expect(toolUrls(s.urls)).toEqual(listed());
  });

  it("slug change: old URL leaves the sitemap, the new one appears, and the old static page goes to the app (301)", async () => {
    // Admin cannot rename slugs yet (Stage 3); this is what a rename does: new slug, a redirect row, a version bump.
    db.raw
      .exec(`UPDATE tools SET slug = 'claude-ai', updated_at = '2099-02-01T00:00:00.000Z' WHERE slug = 'claude';
      INSERT INTO tool_redirects (old_slug, tool_id, created_at)
        SELECT 'claude', id, '2099-02-01T00:00:00.000Z' FROM tools WHERE slug = 'claude-ai';
      UPDATE meta SET value = 'renamed' WHERE key = 'catalog_version';`);
    expect((await get("/tools/claude")).how).toBe("dynamic"); // never the stale static page
    expect(await createD1Reader(db).toolPage("claude")).toEqual({ redirect: "claude-ai" }); // the app: 301
    const s = await sitemap();
    expect(s.urls.has("/tools/claude")).toBe(false);
    expect(s.urls.has("/tools/claude-ai")).toBe(true);
    const search = JSON.parse((await get("/api/search?q=claude")).text);
    expect(search.items.map((i: any) => i.slug)).toContain("claude-ai");
    expect(search.items.map((i: any) => i.slug)).not.toContain("claude");
  });

  it("a tool hidden outside the Admin is not served from static HTML once the catalogue version changed", async () => {
    db.raw.exec("UPDATE tools SET status = 'draft' WHERE slug = 'figma'"); // no updated_at, no audit row
    db.raw.exec("UPDATE meta SET value = 'other-change' WHERE key = 'catalog_version'");
    expect((await get("/tools/figma")).how).toBe("dynamic"); // the app re-checks and answers 404
    expect((await get("/tools/claude")).how).toBe("static"); // still public: static
  });

  it("sitemap index: above the per-file limit the sitemap becomes an index of parts", () => {
    const entries = ["/a", "/b", "/c", "/d", "/e", "/a"].map((path, i): SitemapEntry => ({
      path,
      lastmod: `2026-0${i + 1}-01T00:00:00.000Z`,
      changefreq: "weekly",
      priority: 0.5,
    }));
    const files = sitemapFiles(entries, SITE_URL, 2);
    expect([...files.keys()]).toEqual([
      "/sitemaps/1.xml",
      "/sitemaps/2.xml",
      "/sitemaps/3.xml",
      "/sitemap.xml",
    ]);
    const index = files.get("/sitemap.xml")!;
    expect(index).toContain("<sitemapindex ");
    expect(index.match(/<sitemap>/g)?.length).toBe(3);
    expect(index).toContain(`<loc>${SITE_URL}/sitemaps/3.xml</loc>\n    <lastmod>2026-05-01`);
    const all = [...files.entries()]
      .filter(([p]) => p !== "/sitemap.xml")
      .flatMap(([, x]) => [...x.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]));
    expect(all).toEqual(["/a", "/b", "/c", "/d", "/e"].map((p) => SITE_URL + p)); // duplicate /a dropped
  });

  // ---------------------------------------------------------------- search
  const QUERIES = [
    "",
    "?q=chat",
    "?q=image",
    "?q=AI",
    "?category=ai-writing-tools",
    "?category=ai-writing-tools&q=a",
    "?page=2",
    "?page=999",
    "?q=zzzz-nothing",
    "?category=not-a-category",
  ];
  const sameAsD1 = async () => {
    resetVersionedCache();
    const reader = createD1Reader(db);
    for (const qs of QUERIES) {
      const r = await get(`/api/search${qs}`);
      expect(r.status, qs).toBe(200);
      const q = Object.fromEntries(new URLSearchParams(qs));
      const want = await reader.toolsPage(
        normalizeToolsQuery({ ...q, page: Number(q["page"] ?? 1) }),
      );
      expect(JSON.parse(r.text), qs).toEqual(JSON.parse(JSON.stringify(want)));
    }
  };

  it("search answers from the build's index exactly as the D1 query would, without a React render", async () => {
    await sameAsD1();
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it("search after unpublish, flag, delete, category draft, edit and a new tool: still identical to D1", async () => {
    expect(await act("claude", "unpublish")).toBe(200);
    expect(await act("figma", "flag_needs_review")).toBe(200);
    expect(await act("canva", "archive")).toBe(200);
    const t = (await admin("GET", "tools/canva")).json.tool;
    await admin("DELETE", "tools/canva", { updated_at: t.updated_at, confirm: "canva" });
    expect(await setCategory("ai-seo-tools", "draft")).toBe(200);
    const j = (await admin("GET", "tools/jasper")).json.tool;
    expect(
      (await admin("PUT", "tools/jasper", { ...pickEditable(j), name: "Jasper Renamed" })).status,
    ).toBe(200);
    await admin("POST", "tools", {
      client_id: "00000000-0000-4000-8000-000000000779",
      slug: "searchable-new",
      name: "Searchable New",
      url: "https://searchable.example.com",
      category_id: "ai-writing-tools",
      indexing: "noindex",
      tags: [],
    });
    expect(await act("searchable-new", "publish")).toBe(200);
    await sameAsD1();
    const slugs = async (q: string) =>
      JSON.parse((await get(`/api/search?q=${q}`)).text).items.map((i: any) => i.slug);
    expect(await slugs("claude")).not.toContain("claude");
    expect(await slugs("figma")).not.toContain("figma");
    expect(await slugs("canva")).not.toContain("canva");
    expect(await slugs("semrush")).not.toContain("semrush");
    expect(await slugs("renamed")).toContain("jasper");
    expect(await slugs("searchable")).toContain("searchable-new");
    expect(await setCategory("ai-seo-tools", "published")).toBe(200);
    expect(await slugs("semrush")).toContain("semrush");
    await sameAsD1();
  });

  it("search and sitemap fail closed when D1 is unavailable or over its daily quota, even right after a check", async () => {
    expect((await sitemap()).urls.size).toBeGreaterThan(0); // verified a moment ago
    expect((await get("/api/search?q=chat")).status).toBe(200);
    const spy = vi.spyOn(db, "prepare").mockImplementation(() => {
      throw quota();
    });
    const sm = await get("/sitemap.xml");
    expect(sm.status).toBe(503);
    expect(sm.res.headers.get("retry-after")).toBe("5");
    const s = await get("/api/search?q=chat");
    expect(s.status).toBe(503);
    expect(JSON.parse(s.text)).toEqual({ error: "Search is temporarily unavailable." });
    spy.mockRestore();
    expect((await get("/sitemap.xml")).status).toBe(200);
  });

  // ---------------------------------------------------------------- admin
  it("admin: a D1 quota or outage error is reported clearly, never as a generic failure", async () => {
    expect((await admin("GET", "stats")).status).toBe(200);
    const spy = vi.spyOn(db, "prepare").mockImplementation(() => {
      throw quota();
    });
    let r = await admin("GET", "stats");
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("d1_quota_exceeded");
    expect(r.json.error.message).toMatch(/daily read limit.*00:00 UTC/);
    spy.mockImplementation(() => {
      throw new Error("D1_ERROR: Network connection lost.");
    });
    r = await admin("GET", "tools");
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("database_unavailable");
    spy.mockImplementation(() => {
      throw new Error("D1_ERROR: no such column: nope: SQLITE_ERROR");
    });
    r = await admin("GET", "tools");
    expect(r.status).toBe(500); // a bug stays a bug: no misleading "try later"
    expect(JSON.stringify(r.json)).not.toContain("nope");
    spy.mockRestore();
    // the session check never touches D1, so the admin shell always loads and can show the message
    const sessionSpy = vi.spyOn(db, "prepare");
    expect((await admin("GET", "session")).status).toBe(200);
    expect(sessionSpy).not.toHaveBeenCalled();
  });

  it("admin: the D1 diagnostic is only at /api/admin/db-check, behind authentication", async () => {
    const r = await admin("GET", "db-check", undefined, "admin-stage3-x.acct.workers.dev");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ bound: true, canRead: true });
    const anon = await handleAdminApi(
      new Request("https://admin-stage3-x.acct.workers.dev/api/admin/db-check"),
      { env: async () => goodEnv, db: async () => db },
    );
    expect(anon.status).toBe(401);
    expect(JSON.stringify(Object.keys((routeTree as any).children ?? {}))).not.toMatch(/DbCheck/i);
  });

  it("admin: category counts come from one pass and match direct counts", async () => {
    const items = (await admin("GET", "categories")).json.items;
    expect(items.length).toBeGreaterThan(5);
    for (const c of items) {
      const n = (sql: string, ...p: unknown[]) => (db.raw.prepare(sql).get(...p) as any).n;
      expect([c.tool_count, c.active_tool_count], c.slug).toEqual([
        n("SELECT count(*) n FROM tools WHERE category_id = ?", c.id),
        n("SELECT count(*) n FROM tools WHERE category_id = ? AND status <> 'archived'", c.id),
      ]);
      for (const [sub, count] of Object.entries(c.subcategory_counts))
        expect(
          n("SELECT count(*) n FROM tools WHERE category_id = ? AND subcategory = ?", c.id, sub),
        ).toBe(count);
    }
  });

  it("without a static build (dev server, plain deploy) /api/search is answered by the app with the same shape", async () => {
    const handler = (SearchRoute.options as any).server.handlers.GET as (
      a: any,
    ) => Promise<Response>;
    const res = await handler({
      request: new Request("http://localhost/api/search?q=chat&page=1"),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    const want = await (await getReader()).toolsPage(normalizeToolsQuery({ q: "chat", page: 1 }));
    expect(body).toEqual(JSON.parse(JSON.stringify(want)));
    expect(body.items.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- technical SEO at the gate
  it("trailing-slash variants 301 to the one canonical URL (query kept), and the target is a final 200", async () => {
    for (const [from, to] of [
      ["/tools/claude/", "/tools/claude"],
      ["/categories/ai-writing-tools/", "/categories/ai-writing-tools"],
      ["/tools/", "/tools"],
      ["/about/", "/about"],
      ["/tools/claude/?ref=x", "/tools/claude?ref=x"],
    ] as const) {
      const r = await gate.fetch(new Request(`https://preview.test${from}`), env(), {});
      expect([r.status, r.headers.get("location")], from).toEqual([301, to]);
      const final = await get(to);
      expect(final.status, to).toBe(200); // no chain, no loop
    }
    expect((await get("/")).status).toBe(200); // the root is not redirected
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it("an old slug that already redirected at build time gets a static 301 (no app); after a change the app decides", async () => {
    const r = await gate.fetch(new Request("https://preview.test/tools/claude-old?x=1"), env(), {});
    expect([r.status, r.headers.get("location")]).toEqual([301, "/tools/claude?x=1"]);
    expect((await get("/tools/claude")).how).toBe("static"); // the target is a final 200: no chain
    expect(app.fetch).not.toHaveBeenCalled();
    expect(await act("figma", "archive")).toBe(200); // catalogue changed
    expect((await get("/tools/claude-old")).how).toBe("dynamic"); // the app reads tool_redirects as it is now
  });

  it("without a redirect list (older build) a page that is not pre-built still goes to the app", async () => {
    assets.delete(REDIRECTS_PATH);
    gate = createGate(app, { now: () => clock });
    expect((await get("/tools/brand-new")).how).toBe("dynamic");
  });

  it("public responses from the gate carry no X-Robots-Tag (only 404s and private endpoints do)", async () => {
    for (const p of [
      "/",
      "/tools/claude",
      "/categories/ai-writing-tools",
      "/sitemap.xml",
      "/api/search?q=a",
    ])
      expect((await get(p)).res.headers.get("x-robots-tag"), p).toBeNull();
    expect((await get("/tools/zz-nope")).res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("a category renamed or hidden outside the Admin is not served from static HTML once the version changed", async () => {
    db.raw.exec(`UPDATE categories SET slug = 'ai-writing' WHERE slug = 'ai-writing-tools';
      UPDATE meta SET value = 'cat-renamed' WHERE key = 'catalog_version';`);
    expect((await get("/categories/ai-writing-tools")).how).toBe("dynamic"); // the app answers 404
    expect((await get("/categories/ai-seo-tools")).how).toBe("static");
    expect((await sitemap()).urls.has("/categories/ai-writing-tools")).toBe(false);
  });

  it("robots.txt allows public pages and assets, blocks admin and APIs, and names the production sitemap", () => {
    const robots = readFileSync("public/robots.txt", "utf8");
    const lines = robots.split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain("User-agent: *");
    expect(lines).toContain("Allow: /");
    expect(lines).toContain("Disallow: /admin");
    expect(lines).toContain("Disallow: /api/");
    expect(lines).toContain("Sitemap: https://tryaitools.io/sitemap.xml");
    const disallowed = lines.filter((l) => l.startsWith("Disallow:")).map((l) => l.slice(9).trim());
    for (const d of disallowed)
      for (const p of ["/", "/assets/", "/tools", "/categories", "/sitemap.xml"])
        expect(p.startsWith(d) && d !== "", `${d} blocks ${p}`).toBe(false);
    expect(robots).not.toMatch(/workers\.dev|localhost/);
  });

  it("admin pages skip the public catalogue loader", () => {
    const loader = (RootRoute.options as any).loader as (a: any) => unknown;
    expect(loader({ location: { pathname: "/admin" } })).toBeNull();
    expect(loader({ location: { pathname: "/Admin/tools" } })).toBeNull();
  });

  // ---------------------------------------------------------------- differential check (D1 is the truth)
  it("random Admin change sequences: pages, search and sitemap always agree with D1 after every step", async () => {
    let seed = 20261031;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const TOOLS = ["claude", "figma", "canva", "chatgpt", "semrush", "jasper"];
    const CATS = ["ai-writing-tools", "ai-seo-tools", "ai-image-tools"];
    const isPublic = (slug: string) =>
      !!db.raw
        .prepare(
          `SELECT 1 FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = ? AND t.status = 'published'
             AND t.needs_review = 0 AND c.status = 'published'`,
        )
        .get(slug);
    const exists = (slug: string) =>
      !!db.raw.prepare("SELECT 1 FROM tools WHERE slug = ?").get(slug);
    let created = 0;
    const ops: string[] = [];
    for (let step = 0; step < 60; step++) {
      const slug = TOOLS[rnd(TOOLS.length)]!;
      const kind = rnd(10);
      if (kind <= 5 && exists(slug)) {
        const t = (await admin("GET", `tools/${slug}`)).json.tool;
        const choices = [
          "publish",
          "unpublish",
          "archive",
          "restore",
          "flag_needs_review",
          "clear_needs_review",
        ];
        const a = choices[rnd(choices.length)]!;
        const r = await admin("POST", `tools/${slug}/action`, {
          action: a,
          updated_at: t.updated_at,
        });
        ops.push(`${a} ${slug} -> ${r.status}`);
      } else if (kind === 6 && exists(slug)) {
        const r = await reindex(slug);
        ops.push(`reindex ${slug} -> ${r}`);
      } else if (kind === 7) {
        const c = CATS[rnd(CATS.length)]!;
        const s = ["draft", "published", "published"][rnd(3)]!;
        ops.push(`category ${c} ${s} -> ${await setCategory(c, s)}`);
      } else if (kind === 8 && exists(slug)) {
        const t = (await admin("GET", `tools/${slug}`)).json.tool;
        if (t.status === "archived") {
          const r = await admin("DELETE", `tools/${slug}`, {
            updated_at: t.updated_at,
            confirm: slug,
          });
          ops.push(`delete ${slug} -> ${r.status}`);
        }
      } else {
        const s = `rand-new-${++created}`;
        await admin("POST", "tools", {
          client_id: `00000000-0000-4000-8000-0000000009${String(created).padStart(2, "0")}`,
          slug: s,
          name: `Rand New ${created}`,
          url: `https://${s}.example.com`,
          category_id: CATS[rnd(CATS.length)],
          indexing: "noindex",
          tags: [],
        });
        ops.push(`create+publish ${s} -> ${await act(s, "publish")}`);
        TOOLS.push(s);
      }
      const where = `after step ${step}: ${ops.at(-1)}`;
      // pages: a tool that is not public is never served from static HTML
      for (const s of TOOLS) {
        const how = (await get(`/tools/${s}`)).how;
        if (!isPublic(s)) expect(how, `${where} /tools/${s}`).not.toBe("static");
        else expect(how, `${where} /tools/${s}`).not.toBe("404");
      }
      // search: identical to the D1 query
      resetVersionedCache();
      const reader = createD1Reader(db);
      for (const qs of [
        "?q=a",
        "?q=rand",
        "?category=ai-writing-tools",
        "?category=ai-seo-tools&page=1",
      ]) {
        const q = Object.fromEntries(new URLSearchParams(qs));
        const want = await reader.toolsPage(
          normalizeToolsQuery({ ...q, page: Number(q["page"] ?? 1) }),
        );
        expect(JSON.parse((await get(`/api/search${qs}`)).text), `${where} search ${qs}`).toEqual(
          JSON.parse(JSON.stringify(want)),
        );
      }
      // sitemap: exactly the URLs a fresh build would list now
      const truth = new Set((await sitemapFromDb(db)).map((e) => e.path));
      expect([...(await sitemap()).urls].sort(), where).toEqual([...truth].sort());
    }
    expect(ops.filter((o) => o.endsWith("-> 200")).length).toBeGreaterThan(20); // the sequence really changed things
  }, 60_000);

  const pickEditable = (t: any) => {
    const keys = [
      "name",
      "display_name",
      "url",
      "category_id",
      "subcategory",
      "tags",
      "logo_url",
      "tagline",
      "overview",
      "best_for",
      "features",
      "pros",
      "limits",
      "steps",
      "tips",
      "pricing_note",
      "pricing_source",
      "pricing_model",
      "pricing_plans",
      "pricing_checked_at",
      "platforms",
      "seo_title",
      "seo_description",
      "canonical_url",
      "og_image_url",
      "indexing",
      "updated_at",
    ];
    return Object.fromEntries(keys.map((k) => [k, t[k] ?? (k === "tags" ? [] : null)]));
  };
});

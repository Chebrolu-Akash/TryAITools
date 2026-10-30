// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed rows and JSON in tests */
// The public catalogue: same URLs/SEO as the JSON site, Admin is the source of truth, private rows never leak, and no
// public request ever loads the whole catalogue (Workers Free plan: ~10 ms CPU per request, including cold starts).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import data from "@/data/tools.json";
import { handleAdminApi } from "@/lib/admin/api";
import { PUBLIC_TOOLS } from "@/lib/catalog/d1-reader";
import { createJsonReader } from "@/lib/catalog/json-reader";
import { buildCatalog, toPublic, type PublicCategory, type SourceTool } from "@/lib/catalog/model";
import { getReader, resetReader, type PublicReader } from "@/lib/catalog/reader";
import { cachedByVersion, resetVersionedCache, takeTicket } from "@/lib/catalog/versioned-cache";
import {
  browseOf,
  categoryPageOf,
  PAGE_SIZE,
  sitemapOf,
  summaryOf,
  toolPageOf,
  toolsPageOf,
  normalizeToolsQuery,
} from "@/lib/catalog/views";
import { captureRuntimeEnv } from "@/lib/db/env";
import { buildSitemapXml, sitemapEntries } from "@/lib/sitemap";
import { contentFor } from "@/lib/tool-content";
import {
  alternativesFor,
  isIndexable,
  relatedCategories,
  relatedTools,
  slugOfTool,
} from "@/lib/tool-pages";
import { categories, tools } from "@/lib/tools";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM helper shared with the import scripts
import { importIssue } from "../../scripts/db/slugs.mjs";
import { goodClaims, goodEnv, makeKey, signJwt, staticJwks } from "./helpers/access-jwt";
import { assertSqliteAvailable, createTestDb, type TestDb } from "./helpers/sqlite-d1";

const slugs = (list: { slug: string }[]) => list.map((t) => t.slug);
const jsonFull = buildCatalog({
  source: "json",
  categories: data.categories as PublicCategory[],
  tools: data.tools as SourceTool[],
});

describe("catalogue built from tools.json is identical to the current public site", () => {
  const c = jsonFull;
  const byTool = new Map(tools.map((t) => [slugOfTool(t), t]));

  it("keeps every tool, category, subcategory and slug", () => {
    expect(c.tools).toHaveLength(tools.length);
    expect(c.categories).toEqual(categories);
    expect(slugs(c.tools)).toEqual(tools.map(slugOfTool));
    for (const t of c.tools) {
      const legacy = byTool.get(t.slug)!;
      expect([t.name, t.url, t.category, t.subcategory]).toEqual([
        legacy.name,
        legacy.url,
        legacy.category,
        legacy.subcategory,
      ]);
    }
  });
  it("indexes, suggests and relates exactly the same pages", () => {
    for (const t of c.tools) {
      const legacy = byTool.get(t.slug)!;
      expect(t.indexable).toBe(isIndexable(legacy));
      const alts = c.alternativesFor(t, 6);
      expect(slugs(alts)).toEqual(alternativesFor(legacy, 6).map(slugOfTool));
      expect(slugs(c.relatedTools(t, alts, 4))).toEqual(
        relatedTools(legacy, alternativesFor(legacy, 6), 4).map(slugOfTool),
      );
      expect(c.relatedCategories(t.category)).toEqual(relatedCategories(legacy.category));
      expect(c.contentOf(t)).toEqual(contentFor(legacy));
    }
  });
});

describe("D1 reader", () => {
  it("a SQLite engine is available (never skipped)", () => assertSqliteAvailable());

  // ---------------------------------------------------------------- fixture: tools.json imported exactly as in production
  let importDir = "";
  let importSql: string[] = [];
  let flagged = new Set<string>();
  beforeAll(() => {
    importDir = mkdtempSync(join(tmpdir(), "tryai-import-"));
    const r = spawnSync(
      process.execPath,
      ["scripts/db/build-import.mjs", "--env", "local", "--out", importDir],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`build-import failed: ${r.stderr}`);
    const report = JSON.parse(readFileSync(join(importDir, "report.json"), "utf8"));
    importSql = report.generatedFiles.map((f: string) => readFileSync(join(importDir, f), "utf8"));
    flagged = new Set(jsonFull.tools.filter((t) => importIssue(t)).map((t) => t.slug));
  });
  afterAll(() => rmSync(importDir, { recursive: true, force: true }));

  /** What the public site should show from the imported DB: the JSON catalogue minus flagged rows, same slugs. */
  const expected = () =>
    buildCatalog({
      source: "d1",
      categories: jsonFull.categories,
      tools: jsonFull.tools
        .filter((t) => !flagged.has(t.slug))
        .map((t) => ({ ...toPublic(t), indexing: t.indexable ? "index" : "noindex" })),
    });

  let db: TestDb;
  let reader: PublicReader;
  /** Every SQL statement prepared, and every result's row count, for the CPU-sensitive assertions. */
  let log: { sql: string; rows: number }[] = [];
  const imported = () => {
    const d = createTestDb();
    for (const sql of importSql) d.raw.exec(sql);
    return d;
  };
  const instrument = (d: TestDb) => {
    const prepare = d.prepare.bind(d);
    vi.spyOn(d, "prepare").mockImplementation((sql: string) => {
      const wrap = (st: any): any => ({
        ...st,
        bind: (...p: unknown[]) => wrap(st.bind(...p)),
        all: async () => {
          const r = await st.all();
          log.push({ sql, rows: r.results.length });
          return r;
        },
        first: async () => {
          const r = await st.first();
          log.push({ sql, rows: r ? 1 : 0 });
          return r;
        },
      });
      return wrap(prepare(sql));
    });
  };
  const setVersion = (v: string) =>
    db.raw.exec(`UPDATE meta SET value = '${v}' WHERE key = 'catalog_version'`);

  beforeEach(async () => {
    db = imported();
    resetVersionedCache();
    resetReader();
    captureRuntimeEnv({ DB: db });
    log = [];
    instrument(db);
    reader = await getReader();
    log = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  // ---------------------------------------------------------------- parity: the same pages as the JSON site
  it("tool pages: every public tool is identical to the JSON site (content, SEO, alternatives, related)", async () => {
    expect(reader.source).toBe("d1");
    const json = createJsonReader();
    const e = expected();
    expect(flagged.size).toBe(9);
    for (const t of e.tools) {
      const fromD1 = await reader.toolPage(t.slug);
      expect(fromD1).toEqual(await json.toolPage(t.slug));
    }
    for (const s of flagged) expect(await reader.toolPage(s)).toBeNull();
    expect(await reader.toolPage("no-such-tool")).toBeNull();
  });

  it("category pages, home summary, site summary and sitemap match the JSON site minus flagged rows", async () => {
    const e = expected();
    for (const c of e.categories)
      expect(await reader.categoryPage(c.slug)).toEqual(categoryPageOf(e, c.slug));
    expect(await reader.categoryPage("nope")).toBeNull();
    expect(await reader.browse()).toEqual(browseOf(e));
    expect(await reader.summary()).toEqual(summaryOf(e));
    expect(await reader.sitemap()).toEqual(sitemapOf(e));
    expect(buildSitemapXml(sitemapEntries(await reader.sitemap()))).toBe(
      buildSitemapXml(sitemapEntries(sitemapOf(e))),
    );
  });

  // ---------------------------------------------------------------- /tools: server-side search and pagination
  it("/tools pages through every public tool in display order, 48 at a time", async () => {
    const e = expected();
    const seen: string[] = [];
    for (let page = 1; ; page++) {
      const r = await reader.toolsPage(normalizeToolsQuery({ page }));
      expect(r).toEqual(toolsPageOf(e, normalizeToolsQuery({ page })));
      expect(r.items.length).toBeLessThanOrEqual(PAGE_SIZE);
      if (r.items.length === 0) break;
      seen.push(...slugs(r.items));
    }
    expect(seen).toEqual(slugs(e.tools));
    const past = await reader.toolsPage(normalizeToolsQuery({ page: 999 }));
    expect(past.items).toEqual([]);
    expect(past.total).toBe(e.tools.length);
  });

  it("/tools search and category filters match the old in-browser behaviour, including tricky input", async () => {
    const e = expected();
    const cases = [
      { q: "chat" },
      { q: "CHAT" },
      { q: "writing assistants" },
      { q: "github.com" },
      { q: "%" },
      { q: "_" },
      { q: "'" },
      { q: "zzzz-no-match" },
      { category: "ai-video-tools" },
      { category: "ai-video-tools", q: "edit" },
      { category: "ai-video-tools", q: "edit", page: 2 },
      { category: "not-a-category" },
      { q: "ai", page: 3 },
    ];
    for (const c of cases) {
      const query = normalizeToolsQuery(c);
      expect(await reader.toolsPage(query), JSON.stringify(c)).toEqual(toolsPageOf(e, query));
    }
  });

  it("normalises query input: trims, lower-cases, caps length and page range", () => {
    expect(normalizeToolsQuery({ q: "  ChatGPT ", page: 0 })).toEqual({
      q: "chatgpt",
      category: "",
      page: 1,
    });
    expect(normalizeToolsQuery({ q: "x".repeat(500), page: 10_000 }).q).toHaveLength(100);
    expect(normalizeToolsQuery({ page: 10_000 }).page).toBe(1000);
    expect(normalizeToolsQuery({ page: "abc" as any }).page).toBe(1);
  });

  // ---------------------------------------------------------------- privacy
  it("drafts, review, archived, flagged tools and anything in an unpublished category never appear anywhere", async () => {
    db.raw.exec("UPDATE tools SET status = 'draft' WHERE slug = 'chatgpt'");
    db.raw.exec("UPDATE tools SET status = 'review' WHERE slug = 'midjourney'");
    db.raw.exec("UPDATE tools SET status = 'archived' WHERE slug = 'canva'");
    db.raw.exec("UPDATE tools SET needs_review = 1 WHERE slug = 'grammarly'");
    db.raw.exec("UPDATE categories SET status = 'draft' WHERE slug = 'ai-video-tools'");
    setVersion("private-test");
    const hidden = ["chatgpt", "midjourney", "canva", "grammarly", ...flagged];
    const videoSlugs = slugs(jsonFull.toolsIn("AI Video Tools"));
    const everything = JSON.stringify([
      await reader.browse(),
      await reader.summary(),
      await reader.sitemap(),
      ...(await Promise.all(
        ["", "chatgpt", "midjourney", "canva", "grammarly", "video", "ai"].map((q) =>
          reader.toolsPage(normalizeToolsQuery({ q })),
        ),
      )),
      ...(await Promise.all(
        ["claude", "jasper-ai", "copy-ai", "notion-ai", "figma"].map((s) => reader.toolPage(s)),
      )),
      ...(await Promise.all(expected().categories.map((c) => reader.categoryPage(c.slug)))),
    ]);
    for (const s of [...hidden, ...videoSlugs])
      expect(everything.includes(`"slug":"${s}"`), s).toBe(false);
    const sitemapSlugs = (await reader.sitemap()).toolSlugs;
    const stillPublic = new Set([...hidden, ...videoSlugs]);
    expect(sitemapSlugs).toEqual(
      expected()
        .indexableSlugs()
        .filter((s) => !stillPublic.has(s)),
    );
    expect(everything.includes("ai-video-tools")).toBe(false);
    for (const s of [...hidden, videoSlugs[0]!]) expect(await reader.toolPage(s)).toBeNull();
    expect(await reader.categoryPage("ai-video-tools")).toBeNull();
    expect(
      (await reader.toolsPage(normalizeToolsQuery({ category: "ai-video-tools" }))).total,
    ).toBe(0);
  });

  it("every tools query the reader issues carries the visibility rule", async () => {
    await reader.summary();
    await reader.browse();
    await reader.sitemap();
    await reader.toolsPage(normalizeToolsQuery({ q: "chat", category: "ai-writing-tools" }));
    await reader.toolsPage(normalizeToolsQuery({ page: 2 }));
    await reader.categoryPage("ai-writing-tools");
    await reader.toolPage("chatgpt");
    await reader.toolPage("no-such-tool");
    const toolQueries = log.filter((l) => /\bFROM tools\b/.test(l.sql));
    expect(toolQueries.length).toBeGreaterThan(8);
    for (const l of toolQueries) expect(l.sql, l.sql).toContain(PUBLIC_TOOLS);
  });

  // ---------------------------------------------------------------- CPU-sensitive paths
  const rowsFor = async (fn: () => Promise<unknown>) => {
    log = [];
    await fn();
    return {
      total: log.reduce((s, l) => s + l.rows, 0),
      max: Math.max(0, ...log.map((l) => l.rows)),
      log,
    };
  };

  it("no public request reads more than a few hundred rows (never the 2,225-row catalogue)", async () => {
    const e = expected();
    const biggest = Math.max(...e.categories.map((c) => e.toolsIn(c.name).length));
    expect(biggest).toBeLessThanOrEqual(230);
    const budgets: [string, () => Promise<unknown>, number][] = [
      ["summary", () => reader.summary(), 200],
      ["browse (home, /categories)", () => reader.browse(), 700],
      ["sitemap", () => reader.sitemap(), 100],
      ["/tools page 1", () => reader.toolsPage(normalizeToolsQuery({})), 250],
      ["/tools page 30", () => reader.toolsPage(normalizeToolsQuery({ page: 30 })), 250],
      ["/tools search", () => reader.toolsPage(normalizeToolsQuery({ q: "ai" })), 250],
      [
        "category page (largest)",
        () => reader.categoryPage("ai-education-learning-tools"),
        biggest + 40,
      ],
      ["tool page (shared subcategory)", () => reader.toolPage("chatgpt"), 2 * biggest + 40],
      [
        "tool page (largest category)",
        () => reader.toolPage(slugs(e.toolsIn("AI Education & Learning Tools"))[0]!),
        2 * biggest + 40,
      ],
      ["unknown tool", () => reader.toolPage("no-such-tool"), 40],
    ];
    for (const [label, fn, budget] of budgets) {
      resetVersionedCache(); // measure the cold (uncached) cost
      const { total, max } = await rowsFor(fn);
      expect(total, label).toBeLessThanOrEqual(budget);
      expect(max, label).toBeLessThan(e.tools.length);
    }
  });

  it("cached results cost one tiny version read until the catalogue version changes", async () => {
    await reader.summary();
    await reader.browse();
    await reader.sitemap();
    await reader.toolsPage(normalizeToolsQuery({}));
    const warm = await rowsFor(async () => {
      await reader.summary();
      await reader.browse();
      await reader.sitemap();
      await reader.toolsPage(normalizeToolsQuery({}));
    });
    expect(
      warm.log.every((l) => /key = 'catalog_version'|FROM categories/.test(l.sql) || l.rows <= 1),
    ).toBe(true);
    expect(warm.total).toBeLessThanOrEqual(12);
    setVersion("v-next");
    const cold = await rowsFor(() => reader.summary());
    expect(cold.total).toBeGreaterThan(12);
  });

  // ---------------------------------------------------------------- cold start: tools.json only on the fallback path
  it("cold start on D1 never loads tools.json; the fallback loads it lazily and still works", async () => {
    let loaded = 0;
    vi.resetModules();
    vi.doMock("@/data/tools.json", () => {
      loaded++;
      return { default: data };
    });
    try {
      const fresh = await import("@/lib/catalog/reader");
      const env = await import("@/lib/db/env");
      env.captureRuntimeEnv({ DB: db });
      const r = await fresh.getReader();
      expect(r.source).toBe("d1");
      await r.summary();
      await r.browse();
      await r.sitemap();
      await r.toolsPage(normalizeToolsQuery({ q: "chat" }));
      await r.categoryPage("ai-writing-tools");
      await r.toolPage("chatgpt");
      expect(loaded).toBe(0);
      env.captureRuntimeEnv({});
      const fallback = await fresh.getReader();
      expect(fallback.source).toBe("json");
      expect((await fallback.summary()).toolCount).toBe(tools.length);
      expect(loaded).toBe(1);
    } finally {
      vi.doUnmock("@/data/tools.json");
      vi.resetModules();
    }
  });

  it("falls back to tools.json only when no database is bound or nothing was imported", async () => {
    captureRuntimeEnv({});
    resetReader();
    expect((await getReader()).source).toBe("json");
    captureRuntimeEnv({ DB: createTestDb() });
    resetReader();
    expect((await getReader()).source).toBe("json");
  });

  // ---------------------------------------------------------------- Admin is the source of truth
  it("an Admin publish appears on the next request everywhere; unpublish removes it again", async () => {
    const key = await makeKey("k1");
    const token = await signJwt(key, goodClaims(1_800_000_000));
    let tick = 0;
    const admin = async (method: string, path: string, body?: unknown) => {
      const res = await handleAdminApi(
        new Request(`https://admin.test/api/admin/${path}`, {
          method,
          body: body === undefined ? null : JSON.stringify(body),
          headers: {
            "cf-access-jwt-assertion": token,
            ...(method === "GET"
              ? {}
              : {
                  "x-requested-with": "tryaitools-admin",
                  origin: "https://admin.test",
                  "content-type": "application/json",
                }),
          } as Record<string, string>,
        }),
        {
          env: async () => goodEnv,
          db: async () => db,
          now: () => `2026-10-30T12:00:${String(++tick).padStart(2, "0")}.000Z`,
          auth: { jwks: staticJwks(key), nowSeconds: 1_800_000_000 },
        },
      );
      return { status: res.status, json: await res.json() };
    };
    const before = (await reader.summary()).toolCount;
    await reader.browse(); // warm the caches, so the test proves they are invalidated
    const created = await admin("POST", "tools", {
      client_id: "00000000-0000-4000-8000-000000000123",
      slug: "brand-new-ai",
      name: "Brand New AI",
      url: "https://brand-new.example.com",
      category_id: "ai-writing-tools",
      subcategory: "AI Writing Assistants",
      indexing: "noindex",
      tags: [],
      tagline: "Writes your drafts for you.",
    });
    expect(created.status).toBe(201);
    expect(await reader.toolPage("brand-new-ai")).toBeNull(); // drafts are private
    const pub = await admin("POST", "tools/brand-new-ai/action", {
      action: "publish",
      updated_at: created.json.tool.updated_at,
    });
    expect(pub.status).toBe(200);
    const page = (await reader.toolPage("brand-new-ai")) as any;
    expect(page.tool).toMatchObject({
      category: "AI Writing Tools",
      categorySlug: "ai-writing-tools",
    });
    expect(page.content.tagline).toBe("Writes your drafts for you.");
    expect((await reader.summary()).toolCount).toBe(before + 1);
    expect(slugs((await reader.categoryPage("ai-writing-tools"))!.tools)).toContain("brand-new-ai");
    expect(slugs((await reader.toolsPage(normalizeToolsQuery({ q: "brand new" }))).items)).toEqual([
      "brand-new-ai",
    ]);
    const unpub = await admin("POST", "tools/brand-new-ai/action", {
      action: "unpublish",
      updated_at: pub.json.tool.updated_at,
    });
    expect(unpub.status).toBe(200);
    expect(await reader.toolPage("brand-new-ai")).toBeNull();
    expect((await reader.summary()).toolCount).toBe(before);
  });

  it("databases imported before the fix (template best-for/steps/tips stored on every listing) still match the JSON site", async () => {
    // What the previous import wrote for curated rows: the PRIMARY listing's category guidance on every listing.
    db.raw.exec(
      `UPDATE tools SET best_for = 'Primary category audience', steps = '["Primary step"]', tips = '["Primary tip"]'
        WHERE content_source = 'curated'`,
    );
    const json = createJsonReader();
    for (const s of ["runway-ml-video", "chatgpt-e-commerce", "canva-social-media", "chatgpt"])
      expect(await reader.toolPage(s), s).toEqual(await json.toolPage(s));
    // Once an admin edits the tool, the stored guidance is theirs and is shown.
    db.raw.exec("UPDATE tools SET content_source = 'admin' WHERE slug = 'runway-ml-video'");
    const edited = (await reader.toolPage("runway-ml-video")) as any;
    expect(edited.content.bestFor).toBe("Primary category audience");
    expect(edited.content.steps).toEqual(["Primary step"]);
  });

  it("redirects a retired slug only to a public tool", async () => {
    db.raw.exec(
      "INSERT INTO tool_redirects (old_slug, tool_id) SELECT 'old-chatgpt', id FROM tools WHERE slug = 'chatgpt'",
    );
    expect(await reader.toolPage("old-chatgpt")).toEqual({ redirect: "chatgpt" });
    db.raw.exec("UPDATE tools SET status = 'archived' WHERE slug = 'chatgpt'");
    expect(await reader.toolPage("old-chatgpt")).toBeNull();
  });

  // ---------------------------------------------------------------- D1 failures
  it("on a D1 failure, cached results serve the last good D1 value; per-page reads fail instead of showing tools.json", async () => {
    const good = await reader.summary();
    vi.spyOn(db, "prepare").mockImplementation(() => {
      throw new Error("D1 down");
    });
    expect(await reader.summary()).toEqual(good);
    await expect(reader.toolPage("chatgpt")).rejects.toThrow("D1 down");
    await expect(reader.categoryPage("ai-writing-tools")).rejects.toThrow("D1 down");
  });

  it("the import bumps the catalogue version, so a re-import is picked up without a timed refresh", () => {
    expect(
      db.raw.prepare("SELECT value FROM meta WHERE key = 'catalog_version'").get().value,
    ).toMatch(/^import-\d{4}-/);
  });
});

describe("versioned cache: races between reloads", () => {
  beforeEach(() => resetVersionedCache());
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };

  it("a load for V1 that finishes after the load for V2 cannot overwrite the V2 value", async () => {
    const v1 = deferred<string>();
    const v2 = deferred<string>();
    const t1 = takeTicket();
    const p1 = cachedByVersion("k", "v1", t1, () => v1.promise); // 1. V1 starts
    const t2 = takeTicket();
    const p2 = cachedByVersion("k", "v2", t2, () => v2.promise); // 2-3. version changes, V2 starts
    v2.resolve("V2"); // 4. V2 finishes first
    expect(await p2).toBe("V2");
    v1.resolve("V1"); // 5. V1 finishes later
    expect(await p1).toBe("V1"); // its own caller still gets V1
    const load = vi.fn(async () => "reloaded");
    expect(await cachedByVersion("k", "v2", takeTicket(), load)).toBe("V2");
    expect(load).not.toHaveBeenCalled();
  });

  it("a request that read V1 before a V2 load started joins that load instead of starting an older one", async () => {
    const v2 = deferred<string>();
    const t1 = takeTicket(); // read V1 first...
    const t2 = takeTicket();
    const p2 = cachedByVersion("k", "v2", t2, () => v2.promise);
    const older = vi.fn(async () => "V1");
    const p1 = cachedByVersion("k", "v1", t1, older); // ...but acts on it after V2's load started
    expect(older).not.toHaveBeenCalled();
    v2.resolve("V2");
    expect(await p1).toBe("V2");
    expect(await p2).toBe("V2");
  });

  it("concurrent requests for one version share a single load", async () => {
    const load = vi.fn(async () => "value");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => cachedByVersion("k", "v1", takeTicket(), load)),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set(["value"]));
  });

  it("reset: a load started before resetVersionedCache can never store its value", async () => {
    const old = deferred<string>();
    const p = cachedByVersion("k", "v1", takeTicket(), () => old.promise);
    resetVersionedCache();
    old.resolve("stale");
    expect(await p).toBe("stale");
    const load = vi.fn(async () => "fresh");
    expect(await cachedByVersion("k", "v1", takeTicket(), load)).toBe("fresh");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a failed load stores nothing and does not block the next attempt", async () => {
    await expect(
      cachedByVersion("k", "v1", takeTicket(), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await cachedByVersion("k", "v1", takeTicket(), async () => "ok")).toBe("ok");
  });
});

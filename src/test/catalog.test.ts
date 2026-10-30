// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed rows and JSON in tests */
// The public catalogue: same URLs/SEO as the JSON site, admin is the source of truth, private rows never leak.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi } from "@/lib/admin/api";
import { buildCatalog, toPublic, type Catalog } from "@/lib/catalog/model";
import {
  catalogFromJson,
  getCatalog,
  loadCatalogFromD1,
  redirectFor,
  resetCatalogCache,
} from "@/lib/catalog/source";
import { captureRuntimeEnv } from "@/lib/db/env";
import { featuredFrom } from "@/lib/featured";
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
import { goodClaims, goodEnv, makeKey, signJwt, staticJwks } from "./helpers/access-jwt";
import { assertSqliteAvailable, createTestDb, type TestDb } from "./helpers/sqlite-d1";

const slugs = (list: { slug: string }[]) => list.map((t) => t.slug);

describe("catalogue built from tools.json is identical to the current public site", () => {
  const c = catalogFromJson();
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

describe("D1 as the source of truth", () => {
  it("a SQLite engine is available (never skipped)", () => assertSqliteAvailable());

  let importDir = "";
  let importSql: string[] = [];
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
  });
  afterAll(() => rmSync(importDir, { recursive: true, force: true }));

  let db: TestDb;
  const imported = () => {
    const d = createTestDb();
    for (const sql of importSql) d.raw.exec(sql);
    return d;
  };
  beforeEach(() => {
    db = imported();
    resetCatalogCache();
    captureRuntimeEnv({ DB: db });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const json = catalogFromJson();
  let flagged = new Set<string>();
  beforeAll(() => {
    flagged = new Set(
      imported()
        .raw.prepare("SELECT slug FROM tools WHERE needs_review = 1")
        .all()
        .map((r: any) => r.slug as string),
    );
  });

  it("the imported database publishes every JSON tool except the ones flagged for review, with the same URLs", async () => {
    const c = (await loadCatalogFromD1(db))!;
    expect(c.source).toBe("d1");
    expect(c.categories).toEqual(json.categories);
    const expected = json.tools.filter((t) => !flagged.has(t.slug));
    expect(flagged.size).toBeGreaterThan(0);
    expect(slugs(c.tools)).toEqual(slugs(expected));
    expect(c.tools.map(toPublic)).toEqual(expected.map(toPublic));
    expect(c.indexableSlugs()).toEqual(json.indexableSlugs().filter((s) => !flagged.has(s)));
    for (const t of c.tools.filter((x) => x.indexable))
      expect(c.contentOf(t)).toEqual(json.contentOf(json.bySlug.get(t.slug)!));
  });

  it("never exposes drafts, tools in review, archived or flagged tools, or anything in an unpublished category", async () => {
    db.raw.exec("UPDATE tools SET status = 'draft' WHERE slug = 'chatgpt'");
    db.raw.exec("UPDATE tools SET status = 'review' WHERE slug = 'midjourney'");
    db.raw.exec("UPDATE tools SET status = 'archived' WHERE slug = 'canva'");
    db.raw.exec("UPDATE tools SET needs_review = 1 WHERE slug = 'grammarly'");
    db.raw.exec("UPDATE categories SET status = 'draft' WHERE slug = 'ai-video-tools'");
    const c = (await loadCatalogFromD1(db))!;
    for (const s of ["chatgpt", "midjourney", "canva", "grammarly", ...flagged])
      expect(c.bySlug.has(s as string)).toBe(false);
    expect(c.categoryBySlug("ai-video-tools")).toBeUndefined();
    expect(c.tools.some((t) => t.category === "AI Video Tools")).toBe(false);
    const xml = buildSitemapXml(sitemapEntries(c));
    expect(xml).not.toMatch(/\/tools\/chatgpt</);
    expect(xml).not.toMatch(/ai-video-tools/);
    expect(featuredFrom(c.tools).some((f) => f.slug === "chatgpt")).toBe(false);
  });

  it("an admin publish appears on the next read; unpublish and archive remove it again", async () => {
    const key = await makeKey("k1");
    const token = await signJwt(key, goodClaims(1_800_000_000));
    let tick = 0;
    const admin = async (method: string, path: string, body?: unknown) => {
      const res = await handleAdminApi(
        new Request(`https://admin.test/api/admin/${path}`, {
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: {
            "cf-access-jwt-assertion": token,
            ...(method === "GET"
              ? {}
              : {
                  "x-requested-with": "tryaitools-admin",
                  origin: "https://admin.test",
                  "content-type": "application/json",
                }),
          },
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

    const before = await getCatalog();
    expect(before.source).toBe("d1");
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
    expect((await getCatalog()).bySlug.has("brand-new-ai")).toBe(false); // a draft is private

    const pub = await admin("POST", "tools/brand-new-ai/action", {
      action: "publish",
      updated_at: created.json.tool.updated_at,
    });
    expect(pub.status).toBe(200);
    const after = await getCatalog();
    const t = after.bySlug.get("brand-new-ai")!;
    expect(t).toMatchObject({ category: "AI Writing Tools", categorySlug: "ai-writing-tools" });
    expect(after.toolsIn("AI Writing Tools").some((x) => x.slug === "brand-new-ai")).toBe(true);
    expect(after.contentOf(t).tagline).toBe("Writes your drafts for you.");
    expect(after.tools.length).toBe(before.tools.length + 1);

    const unpub = await admin("POST", "tools/brand-new-ai/action", {
      action: "unpublish",
      updated_at: pub.json.tool.updated_at,
    });
    expect(unpub.status).toBe(200);
    expect((await getCatalog()).bySlug.has("brand-new-ai")).toBe(false);
  });

  it("caches between requests and reloads as soon as the catalogue version changes", async () => {
    const spy = vi.spyOn(db, "prepare");
    await getCatalog();
    const first = spy.mock.calls.length;
    await getCatalog();
    expect(spy.mock.calls.length - first).toBe(1); // only the version check
    db.raw.exec("UPDATE tools SET status = 'draft' WHERE slug = 'chatgpt'");
    expect((await getCatalog()).bySlug.has("chatgpt")).toBe(true); // version unchanged: still cached
    db.raw.exec("INSERT INTO meta (key, value) VALUES ('catalog_version', 'v2')");
    expect((await getCatalog()).bySlug.has("chatgpt")).toBe(false);
  });

  it("redirects a retired slug only to a public tool", async () => {
    db.raw.exec(
      "INSERT INTO tool_redirects (old_slug, tool_id) SELECT 'old-chatgpt', id FROM tools WHERE slug = 'chatgpt'",
    );
    let c = (await loadCatalogFromD1(db))!;
    expect(await redirectFor("old-chatgpt", c)).toBe("chatgpt");
    expect(await redirectFor("nope", c)).toBeNull();
    db.raw.exec("UPDATE tools SET status = 'archived' WHERE slug = 'chatgpt'");
    c = (await loadCatalogFromD1(db))!;
    expect(await redirectFor("old-chatgpt", c)).toBeNull();
  });

  it("falls back to tools.json only when there is no database or nothing was imported", async () => {
    captureRuntimeEnv({});
    resetCatalogCache();
    expect((await getCatalog()).source).toBe("json");
    const empty = createTestDb();
    captureRuntimeEnv({ DB: empty });
    resetCatalogCache();
    expect((await getCatalog()).source).toBe("json");
  });

  it("keeps serving the last good D1 catalogue when D1 fails, instead of resurrecting unpublished JSON rows", async () => {
    db.raw.exec("UPDATE tools SET status = 'archived' WHERE slug = 'chatgpt'");
    const ok = await getCatalog();
    expect(ok.bySlug.has("chatgpt")).toBe(false);
    vi.spyOn(db, "prepare").mockImplementation(() => {
      throw new Error("D1 down");
    });
    const c: Catalog = await getCatalog();
    expect(c.source).toBe("d1");
    expect(c.bySlug.has("chatgpt")).toBe(false);
  });
});

describe("catalogue model", () => {
  it("drops tools whose category is not public and honours stored slugs and indexing", () => {
    const c = buildCatalog({
      source: "d1",
      categories: [{ name: "A", slug: "a", subcategories: ["S"] }],
      tools: [
        {
          name: "One",
          url: "https://one.example.com",
          category: "A",
          subcategory: "S",
          slug: "custom-one",
          indexing: "index",
        },
        {
          name: "Two",
          url: "https://two.example.com",
          category: "Hidden",
          subcategory: "",
          slug: "two",
          indexing: "index",
        },
      ],
    });
    expect(slugs(c.tools)).toEqual(["custom-one"]);
    expect(c.indexableSlugs()).toEqual(["custom-one"]);
  });
});

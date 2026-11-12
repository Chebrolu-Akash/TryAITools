// @vitest-environment node
// A category an editor sets to noindex (admin: categories.indexing) must be noindex on its page and absent from the
// sitemap, both in the pre-built sitemap and in the between-builds update. Its tools keep their own indexing decision.
import { beforeEach, describe, expect, it } from "vitest";

import { createD1Reader } from "@/lib/catalog/d1-reader";
import { resetVersionedCache } from "@/lib/catalog/versioned-cache";
import type { CategoryPageData } from "@/lib/catalog/views";
import { Route as CategoryRoute } from "@/routes/categories.$slug";
import { sitemapFromDb, sitemapSince } from "@/static/sitemap";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

const OLD = "2026-01-01T00:00:00.000Z";
const SNAPSHOT = "2026-06-01T00:00:00.000Z";
const LATER = "2026-07-01T00:00:00.000Z";

function seed(db: TestDb) {
  db.raw.exec(`
    INSERT INTO meta (key, value) VALUES ('catalog_version', 'v1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    INSERT INTO categories (id, slug, name, status, indexing, created_at, updated_at) VALUES
      ('c1', 'writing', 'Writing', 'published', 'index',   '${OLD}', '${OLD}'),
      ('c2', 'thin',    'Thin',    'published', 'noindex', '${OLD}', '${OLD}');
    INSERT INTO tools (id, slug, name, url, category_id, status, indexing, created_at, updated_at) VALUES
      ('t1', 'writer-ai', 'Writer AI', 'https://w.example.com', 'c1', 'published', 'index', '${OLD}', '${OLD}'),
      ('t2', 'thin-ai',   'Thin AI',   'https://t.example.com', 'c2', 'published', 'index', '${OLD}', '${OLD}');`);
}

const paths = (e: { path: string }[]) => e.map((x) => x.path);
type Tag = Record<string, string>;
type Head = { meta: Tag[]; links: Tag[] };
const head = (loaderData: Partial<CategoryPageData> | undefined, slug: string) =>
  (CategoryRoute.options.head as (ctx: unknown) => Head)({
    loaderData,
    params: { slug },
  });
const robots = (h: Head) => h.meta.filter((m) => m["name"] === "robots");

describe("category indexing", () => {
  let db: TestDb;
  beforeEach(() => {
    resetVersionedCache();
    db = createTestDb();
    seed(db);
  });

  it("the reader reports each category's indexing and keeps it out of the public category data", async () => {
    const reader = createD1Reader(db);
    const thin = (await reader.categoryPage("thin"))!;
    const writing = (await reader.categoryPage("writing"))!;
    expect(thin.indexable).toBe(false);
    expect(writing.indexable).toBe(true);
    expect(Object.keys(thin.category).sort()).toEqual(["name", "slug", "subcategories"]);
    // a noindex category still lists its tools and appears in the sidebar
    expect(thin.tools.map((t) => t.slug)).toEqual(["thin-ai"]);
    expect(writing.categories.map((c) => c.slug)).toEqual(["thin", "writing"]);
    // tool pages are unaffected (their categories are built without the indexing flag)
    expect(await reader.toolPage("thin-ai")).toMatchObject({ tool: { categorySlug: "thin" } });
  });

  it("the category page: noindex (keeping its canonical) only when the category is set to noindex", () => {
    const off = head(
      { indexable: false, category: { name: "Thin", slug: "thin", subcategories: [] } },
      "thin",
    );
    expect(robots(off)).toEqual([{ name: "robots", content: "noindex, follow" }]);
    expect(off.links).toEqual([
      { rel: "canonical", href: "https://tryaitools.io/categories/thin" },
    ]);

    const on = head(
      { indexable: true, category: { name: "Writing", slug: "writing", subcategories: [] } },
      "writing",
    );
    expect(robots(on)).toEqual([]);
    expect(on.links).toEqual([
      { rel: "canonical", href: "https://tryaitools.io/categories/writing" },
    ]);

    const missing = head(undefined, "nope"); // not found: noindex and no canonical, as before
    expect(robots(missing)).toEqual([{ name: "robots", content: "noindex, follow" }]);
    expect(missing.links).toEqual([]);
  });

  it("the pre-built sitemap leaves out a noindex category but keeps its indexable tools", async () => {
    const entries = paths(await sitemapFromDb(db));
    expect(entries).toContain("/categories/writing");
    expect(entries).not.toContain("/categories/thin");
    expect(entries).toContain("/tools/thin-ai");
    expect(entries).toContain("/tools/writer-ai");
  });

  it("the dynamic sitemap leaves it out too", async () => {
    const s = await createD1Reader(db).sitemap();
    expect(s.categorySlugs).toEqual(["writing"]);
    expect(s.toolSlugs.sort()).toEqual(["thin-ai", "writer-ai"]);
  });

  it("between builds: a category switched to noindex is dropped, and comes back when indexed again", async () => {
    db.raw.exec(`UPDATE categories SET indexing = 'index' WHERE id = 'c2'`);
    const base = { snapshotAt: SNAPSHOT, entries: await sitemapFromDb(db) };
    expect(paths(base.entries)).toContain("/categories/thin");

    db.raw.exec(
      `UPDATE categories SET indexing = 'noindex', updated_at = '${LATER}' WHERE id = 'c2'`,
    );
    let now = paths(await sitemapSince(db, base));
    expect(now).not.toContain("/categories/thin");
    expect(now).toContain("/categories/writing");
    expect(now).toContain("/tools/thin-ai"); // the tool's own decision is unchanged

    db.raw.exec(`UPDATE categories SET indexing = 'index' WHERE id = 'c2'`);
    now = paths(await sitemapSince(db, base));
    expect(now).toContain("/categories/thin");
  });
});

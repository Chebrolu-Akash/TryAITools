// @vitest-environment node
// Shared category memberships (migration 0010): one tool, one URL, listed on several category pages. Category pages,
// counts, home previews, /tools filtering (D1 and the static search index) include it; the site total counts it once;
// a database without the table behaves exactly as before.
import { beforeEach, describe, expect, it } from "vitest";

import { createD1Reader } from "@/lib/catalog/d1-reader";
import { normalizeToolsQuery } from "@/lib/catalog/views";
import { resetVersionedCache } from "@/lib/catalog/versioned-cache";
import { searchIndexFromDb, searchPage } from "@/static/search";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

function seed(db: TestDb) {
  db.raw.exec(`
    INSERT INTO meta (key, value) VALUES ('catalog_version', 'v1') ON CONFLICT(key) DO UPDATE SET value = 'v1';
    INSERT INTO categories (id, slug, name, subcategories, sort_order, status) VALUES
      ('writing', 'writing', 'Writing', '["Assistants"]', 1, 'published'),
      ('video', 'video', 'Video', '["Generation","Avatars"]', 2, 'published'),
      ('hidden', 'hidden', 'Hidden', '[]', 3, 'draft');
    INSERT INTO tools (id, slug, name, url, category_id, subcategory, status, indexing, sort_order) VALUES
      ('a', 'alpha', 'Alpha', 'https://a.example.com', 'writing', 'Assistants', 'published', 'index', 1),
      ('b', 'beta', 'Beta', 'https://b.example.com', 'video', 'Generation', 'published', 'noindex', 2),
      ('c', 'gamma', 'Gamma', 'https://c.example.com', 'writing', 'Assistants', 'draft', 'noindex', 3);
    INSERT INTO tool_categories (tool_id, category_id, subcategory) VALUES
      ('a', 'video', 'Avatars'),   -- alpha also listed in Video / Avatars
      ('c', 'video', 'Avatars'),   -- a draft tool: never public through a membership
      ('a', 'hidden', NULL);       -- an unpublished category: ignored`);
}
const slugs = (xs: { slug: string }[]) => xs.map((x) => x.slug);

describe("shared category memberships", () => {
  let db: TestDb;
  beforeEach(() => {
    resetVersionedCache();
    db = createTestDb();
    seed(db);
  });

  it("a category page lists its own tools and its member tools, in display order, each linking to the one tool URL", async () => {
    const p = (await createD1Reader(db).categoryPage("video"))!;
    expect(slugs(p.tools)).toEqual(["alpha", "beta"]);
    const alpha = p.tools.find((t) => t.slug === "alpha")!;
    expect(alpha.subcategory).toBe("Avatars"); // the membership's subcategory on this page (for its filter)
    expect(slugs((await createD1Reader(db).categoryPage("writing"))!.tools)).toEqual(["alpha"]);
    // sidebar counts include memberships
    expect(p.categories.find((c) => c.slug === "video")!.toolCount).toBe(2);
  });

  it("home: category counts and subcategory previews include members; the site total counts each tool once", async () => {
    const b = await createD1Reader(db).browse();
    const video = b.categories.find((c) => c.slug === "video")!;
    expect(video.toolCount).toBe(2);
    expect(
      video.subcategories.find((s) => s.name === "Avatars")!.preview.map((t) => t.slug),
    ).toEqual(["alpha"]);
    expect(b.toolCount).toBe(2); // alpha + beta, not 3
  });

  it("/tools?category= includes member tools (D1 reader), and totals agree", async () => {
    const r = createD1Reader(db);
    const v = await r.toolsPage(normalizeToolsQuery({ category: "video" }));
    expect(slugs(v.items)).toEqual(["alpha", "beta"]);
    expect(v.total).toBe(2);
    const all = await r.toolsPage(normalizeToolsQuery({}));
    expect(all.total).toBe(2);
    const q = await r.toolsPage(normalizeToolsQuery({ category: "video", q: "alp" }));
    expect(slugs(q.items)).toEqual(["alpha"]);
  });

  it("the static search index carries memberships, so filtering on the pre-built site matches D1", async () => {
    const idx = await searchIndexFromDb(db);
    const alpha = idx.tools.find((t) => t[0] === "alpha")!;
    expect(alpha[9]).toEqual(["video"]);
    const page = searchPage(idx, normalizeToolsQuery({ category: "video" }), 24);
    expect(slugs(page.items)).toEqual(["alpha", "beta"]);
    expect(page.items[0]!.categorySlug).toBe("writing"); // the card still shows the tool's own category
  });

  it("a database without the tool_categories table works exactly as before", async () => {
    db.raw.exec("DROP TABLE tool_categories");
    resetVersionedCache();
    const r = createD1Reader(db);
    expect(slugs((await r.categoryPage("video"))!.tools)).toEqual(["beta"]);
    expect((await r.browse()).toolCount).toBe(2);
    expect(slugs((await r.toolsPage(normalizeToolsQuery({ category: "video" }))).items)).toEqual([
      "beta",
    ]);
    const idx = await searchIndexFromDb(db);
    expect(idx.tools.find((t) => t[0] === "alpha")![9]).toBeUndefined();
  });
});

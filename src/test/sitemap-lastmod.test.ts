// @vitest-environment node
// Sitemap lastmod follows genuine visible content changes only: Admin edits, approved drafts, bulk edits of visible fields,
// approved scripted category/URL changes and the recorded content imports (at their own timestamps). Status, indexing,
// stored drafts and URL health checks never move a tool's lastmod, and invisible events move nothing at all.
import { beforeEach, describe, expect, it } from "vitest";

import {
  isContentEvent,
  isInvisibleEvent,
  sitemapFromDb,
  sitemapSince,
  type SitemapEntry,
} from "@/static/sitemap";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

const CREATED = "2026-10-26T10:22:25.000Z";
const IMPORT_1 = "2026-11-01T07:32:36.373Z";
const IMPORT_2 = "2026-11-01T07:45:10.189Z";
const IMPORTS = [
  { at: IMPORT_1, slugs: ["alpha", "beta", "gamma"] },
  { at: IMPORT_2, slugs: ["beta"] },
];

function seed(db: TestDb) {
  db.raw.exec(`
    INSERT INTO categories (id, slug, name, status, indexing, created_at, updated_at) VALUES
      ('c1', 'writing', 'Writing', 'published', 'index', '${CREATED}', '${CREATED}'),
      ('c2', 'video',   'Video',   'published', 'index', '${CREATED}', '${CREATED}');
    INSERT INTO tools (id, slug, name, url, category_id, status, indexing, created_at, updated_at) VALUES
      ('t1', 'alpha', 'Alpha', 'https://a.example.com', 'c1', 'published', 'index', '${CREATED}', '${IMPORT_1}'),
      ('t2', 'beta',  'Beta',  'https://b.example.com', 'c1', 'published', 'index', '${CREATED}', '${IMPORT_2}'),
      ('t3', 'gamma', 'Gamma', 'https://g.example.com', 'c2', 'published', 'index', '${CREATED}', '${IMPORT_1}'),
      ('t4', 'late',  'Late',  'https://l.example.com', 'c2', 'published', 'index', '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z');`);
}
const event = (db: TestDb, action: string, slug: string, at: string, summary = "") =>
  db.raw
    .prepare(
      "INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) VALUES (?, 'x@example.com', ?, 'tool', ?, ?)",
    )
    .run(at, action, slug, summary);
const lastmod = (entries: SitemapEntry[], path: string) =>
  entries.find((e) => e.path === path)?.lastmod;

describe("sitemap lastmod", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    seed(db);
  });

  it("without recorded imports a tool keeps its creation date (the old behaviour)", async () => {
    const e = await sitemapFromDb(db);
    expect(lastmod(e, "/tools/alpha")).toBe(CREATED);
    expect(lastmod(e, "/categories/writing")).toBe(CREATED);
  });

  it("a recorded import sets lastmod to the import's own timestamp, only for the tools it changed", async () => {
    const e = await sitemapFromDb(db, IMPORTS);
    expect(lastmod(e, "/tools/alpha")).toBe(IMPORT_1);
    expect(lastmod(e, "/tools/beta")).toBe(IMPORT_2); // the newest import that changed it
    expect(lastmod(e, "/tools/gamma")).toBe(IMPORT_1);
    expect(lastmod(e, "/tools/late")).toBe("2026-11-05T00:00:00.000Z"); // unaffected, created afterwards
    // category pages show the tools' pricing badges and tags, so they follow the newest change among their tools
    expect(lastmod(e, "/categories/writing")).toBe(IMPORT_2);
    expect(lastmod(e, "/categories/video")).toBe("2026-11-05T00:00:00.000Z");
    expect(lastmod(e, "/")).toBe("2026-11-05T00:00:00.000Z");
  });

  it("an import never applies to a tool created after it ran, and never moves dates forward past the evidence", async () => {
    const e = await sitemapFromDb(db, [{ at: IMPORT_1, slugs: ["late"] }]);
    expect(lastmod(e, "/tools/late")).toBe("2026-11-05T00:00:00.000Z");
    for (const x of e) if (x.lastmod) expect(x.lastmod <= "2026-11-05T00:00:00.000Z").toBe(true);
  });

  it("visible changes move a tool's lastmod; status, indexing, drafts and URL checks do not", async () => {
    event(db, "tool.update", "alpha", "2026-11-02T00:00:00.000Z");
    event(db, "tool.review_approve", "beta", "2026-11-03T00:00:00.000Z");
    event(
      db,
      "tool.bulk_update",
      "gamma",
      "2026-11-04T00:00:00.000Z",
      'Bulk set: pricing_model: null → "paid"',
    );
    // none of these changes what the tool page shows
    event(db, "tool.review_draft", "alpha", "2026-11-09T00:00:00.000Z", "Generated review draft");
    event(db, "tool.cleanup", "alpha", "2026-11-08T00:00:00.000Z", "url status ok");
    event(
      db,
      "tool.bulk_update",
      "beta",
      "2026-11-08T00:00:00.000Z",
      'Bulk set: indexing: "noindex" → "index"',
    );
    event(db, "tool.publish", "gamma", "2026-11-08T00:00:00.000Z");
    const e = await sitemapFromDb(db, IMPORTS);
    expect(lastmod(e, "/tools/alpha")).toBe("2026-11-02T00:00:00.000Z");
    expect(lastmod(e, "/tools/beta")).toBe("2026-11-03T00:00:00.000Z");
    expect(lastmod(e, "/tools/gamma")).toBe("2026-11-04T00:00:00.000Z");
    // indexing/publish change what the category page lists (top picks, the list): they move it; the URL check and
    // the stored draft do not
    expect(lastmod(e, "/categories/writing")).toBe("2026-11-08T00:00:00.000Z");
    expect(lastmod(e, "/categories/video")).toBe("2026-11-08T00:00:00.000Z");
  });

  it("invisible events move nothing: a category whose tools only had drafts and URL checks keeps its date", async () => {
    event(db, "tool.review_draft", "alpha", "2026-11-09T00:00:00.000Z", "Generated review draft");
    event(
      db,
      "tool.cleanup",
      "beta",
      "2026-11-08T00:00:00.000Z",
      "needs manual review: page returns 404",
    );
    const e = await sitemapFromDb(db, IMPORTS);
    expect(lastmod(e, "/categories/writing")).toBe(IMPORT_2);
    expect(lastmod(e, "/tools/alpha")).toBe(IMPORT_1);
  });

  it("scripted category moves and new official URLs count; the batch-level import row does not name a tool", () => {
    expect(isContentEvent("tool.cleanup", "x", "category a/b -> c/d")).toBe(true);
    expect(isContentEvent("tool.cleanup", "x", "url status ok; category a/b -> c/d")).toBe(true);
    expect(isContentEvent("tool.cleanup", "x", "url https://a.example -> https://b.example")).toBe(
      true,
    );
    expect(isContentEvent("tool.dead_listing", "x", "URL updated: https://a -> https://b")).toBe(
      true,
    );
    expect(isContentEvent("tool.cleanup", "x", "url status blocked")).toBe(false);
    expect(isContentEvent("tool.dead_listing", "x", "Unpublished to draft: gone")).toBe(false);
    expect(isContentEvent("tool.bulk_update", "metadata-import", "tags: [] → [x]")).toBe(false);
    expect(isContentEvent("tool.bulk_update", "x", 'Bulk set: tags: [] → ["AI Writing"]')).toBe(
      true,
    );
    expect(isContentEvent("tool.bulk_update", "x", 'Bulk set: review_status: "a" → "b"')).toBe(
      false,
    );
    expect(isInvisibleEvent("tool.cleanup", "url status ok")).toBe(true);
    expect(isInvisibleEvent("tool.cleanup", "needs manual review: x; category a -> b")).toBe(false);
    expect(isInvisibleEvent("tool.publish", "")).toBe(false);
  });

  it("the SQL rule and the JS rule agree on every event kind", async () => {
    const cases: [string, string, string][] = [
      ["tool.update", "alpha", ""],
      ["tool.review_approve", "alpha", ""],
      ["tool.bulk_update", "alpha", 'Bulk set: subcategory: "a" → "b"'],
      ["tool.bulk_update", "alpha", 'Bulk set: status: "draft" → "published"'],
      ["tool.cleanup", "alpha", "category a/b -> c/d"],
      ["tool.cleanup", "alpha", "url status ok"],
      ["tool.dead_listing", "alpha", "URL updated: https://a -> https://b"],
      ["tool.review_draft", "alpha", "draft"],
    ];
    for (const [i, [action, slug, summary]] of cases.entries()) {
      db.raw.exec("DELETE FROM audit_events");
      const at = `2026-11-1${i}T00:00:00.000Z`;
      event(db, action, slug, at, summary);
      const e = await sitemapFromDb(db);
      expect([action, summary, lastmod(e, "/tools/alpha") === at]).toEqual([
        action,
        summary,
        isContentEvent(action, slug, summary),
      ]);
    }
  });

  it("between builds, only visible changes move lastmod", async () => {
    const SNAP = "2026-11-06T00:00:00.000Z";
    const base = { snapshotAt: SNAP, entries: await sitemapFromDb(db, IMPORTS) };
    event(db, "tool.review_draft", "alpha", "2026-11-09T00:00:00.000Z", "Generated review draft");
    event(db, "tool.cleanup", "gamma", "2026-11-08T00:00:00.000Z", "url status ok");
    let now = await sitemapSince(db, base);
    expect(lastmod(now, "/tools/alpha")).toBe(IMPORT_1);
    expect(lastmod(now, "/categories/writing")).toBe(IMPORT_2);
    expect(lastmod(now, "/categories/video")).toBe("2026-11-05T00:00:00.000Z");
    event(db, "tool.review_approve", "alpha", "2026-11-10T00:00:00.000Z");
    now = await sitemapSince(db, base);
    expect(lastmod(now, "/tools/alpha")).toBe("2026-11-10T00:00:00.000Z");
    expect(lastmod(now, "/categories/writing")).toBe("2026-11-10T00:00:00.000Z");
    expect(lastmod(now, "/")).toBe("2026-11-10T00:00:00.000Z");
  });
});

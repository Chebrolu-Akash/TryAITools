// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed rows in tests */
// UI refresh: the /tools pricing filter (static search index, D1 reader and JSON fallback agree), inline affiliate boxes
// removed from detail pages (footer disclosure kept), the circular logo and icons, the centred header and page width.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createD1Reader } from "@/lib/catalog/d1-reader";
import { resetVersionedCache } from "@/lib/catalog/versioned-cache";
import { searchUrl } from "@/lib/catalog/search-client";
import { normalizeToolsQuery, PAGE_SIZE } from "@/lib/catalog/views";
import { createJsonReader } from "@/lib/catalog/json-reader";
import { searchIndexFromDb, searchPage } from "@/static/search";
import { createTestDb } from "./helpers/sqlite-d1";

const SEED = [
  "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('w','ai-writing-tools','AI Writing Tools','[\"Sub\"]',1,'published')",
  "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('v','ai-video-tools','AI Video Tools','[\"Clips\"]',2,'published')",
  ...[
    ["a", "Alpha Writer", "w", "free"],
    ["b", "Beta Writer", "w", "paid"],
    ["c", "Gamma Writer", "w", null],
    ["d", "Delta Video", "v", "free"],
    ["e", "Echo Video", "v", "freemium"],
  ].map(
    ([slug, name, cat, p], i) =>
      `INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,sort_order,pricing_model) VALUES ('t${i}','${slug}','${name}','https://${slug}.example','${cat}','${cat === "w" ? "Sub" : "Clips"}','published','index',0,${i},${p ? `'${p}'` : "NULL"})`,
  ),
];

describe("/tools pricing filter", () => {
  const db = () => createTestDb({ seed: SEED });
  const q = (o: Record<string, unknown>) => normalizeToolsQuery({ page: 1, ...o } as any);
  const cases: [Record<string, unknown>, string[]][] = [
    [{}, ["a", "b", "c", "d", "e"]],
    [{ pricing: "free" }, ["a", "d"]],
    [{ pricing: "free", category: "ai-writing-tools" }, ["a"]],
    [{ pricing: "paid", q: "writer" }, ["b"]],
    [{ pricing: "freemium", q: "writer" }, []],
    [{ pricing: "free_trial" }, []], // nothing recorded as a free trial: no guessing
  ];

  it("the static search index and the D1 reader return the same tools for every combination", async () => {
    const d = db();
    const index = await searchIndexFromDb(d);
    for (const [input, want] of cases) {
      resetVersionedCache();
      const fromIndex = searchPage(index, q(input), PAGE_SIZE);
      const fromD1 = await createD1Reader(d).toolsPage(q(input));
      expect(
        fromIndex.items.map((t) => t.slug),
        JSON.stringify(input),
      ).toEqual(want);
      expect(
        fromD1.items.map((t) => t.slug),
        JSON.stringify(input),
      ).toEqual(want);
      expect(fromIndex.total).toBe(want.length);
      expect(fromD1.total).toBe(want.length);
      expect(fromIndex.pricing).toBe(input["pricing"] ?? "all");
    }
  });

  it("cards carry their recorded pricing; unrecorded tools carry none", async () => {
    const page = searchPage(await searchIndexFromDb(db()), q({}), PAGE_SIZE);
    expect(Object.fromEntries(page.items.map((t) => [t.slug, t.pricing ?? null]))).toEqual({
      a: "free",
      b: "paid",
      c: null,
      d: "free",
      e: "freemium",
    });
  });

  it("the bundled JSON fallback has no pricing, so a pricing filter finds nothing there (never guessed)", async () => {
    const r = createJsonReader();
    expect((await r.toolsPage(q({}))).total).toBeGreaterThan(1000);
    expect((await r.toolsPage(q({ pricing: "free" }))).total).toBe(0);
  });

  it("the filter travels in the URL and through 'Load more'; 'All' adds nothing", () => {
    expect(searchUrl({ q: "x", pricing: "free_trial", page: 2 })).toBe(
      "/api/search?q=x&pricing=free_trial&page=2",
    );
    expect(searchUrl({ pricing: "all" })).toBe("/api/search");
    const page = readFileSync("src/routes/tools.index.tsx", "utf8");
    expect(page).toContain('pricing: result.pricing ?? "all"'); // Load more keeps the filter
    expect(page).toContain('aria-label="Filter by pricing"');
    // the page and its canonical stay the same: the filter is browser-side only
    expect(page).toContain('path: "/tools"');
  });
});

describe("affiliate disclosures", () => {
  it("no inline affiliate boxes on course, book, tutorial or gadget pages; the footer keeps the disclosure", () => {
    for (const f of [
      "src/components/site/LearnPages.tsx",
      "src/routes/gadgets.$slug.tsx",
      "src/routes/learn.courses.$slug.tsx",
      "src/routes/learn.books.$slug.tsx",
      "src/routes/learn.tutorials.$slug.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/This is an affiliate link|qualifying purchases|notice=/);
    }
    expect(readFileSync("src/components/site/Layout.tsx", "utf8")).toContain(
      "Some links are affiliate links.",
    );
    // affiliate links themselves are still marked
    expect(readFileSync("src/components/site/ContentViews.tsx", "utf8")).toContain(
      'SPONSORED_REL = "sponsored nofollow noopener noreferrer"',
    );
    // the sponsored-content disclosure on guest articles stays (it is not an affiliate notice)
    expect(readFileSync("src/routes/guest-articles.$slug.tsx", "utf8")).toContain(
      "this article was paid for by",
    );
  });
});

describe("branding and layout", () => {
  const png = (f: string) => {
    const b = readFileSync(`public/${f}`);
    expect(b.subarray(1, 4).toString(), f).toBe("PNG");
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };

  it("every logo and icon file is the square circular logo at its stated size (never stretched)", () => {
    for (const [f, n] of [
      ["logo.png", 192],
      ["logo-512.png", 512],
      ["icon-192.png", 192],
      ["icon-512.png", 512],
      ["icon-maskable-512.png", 512],
      ["favicon-16.png", 16],
      ["favicon-32.png", 32],
      ["favicon-48.png", 48],
      ["apple-touch-icon.png", 180],
    ] as const)
      expect(png(f), f).toEqual([n, n]);
    expect(png("og-image.png")).toEqual([1200, 630]);
    const manifest = JSON.parse(readFileSync("public/site.webmanifest", "utf8"));
    expect(manifest.icons.find((i: any) => i.purpose === "maskable").src).toBe(
      "/icon-maskable-512.png",
    );
    const layout = readFileSync("src/components/site/Layout.tsx", "utf8");
    expect(layout).toMatch(/src="\/logo\.png(\?v=\d+)?"/);
    // The supplied logo has a transparent background outside the circle (corner pixel alpha = 0).
    const ico = readFileSync("public/favicon.ico");
    expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]); // icon file, 16/32/48 entries
    expect(layout).toContain("rounded-full object-contain");
  });

  it("the header centres its links between the logo and a matching spacer", () => {
    const layout = readFileSync("src/components/site/Layout.tsx", "utf8");
    expect(layout).toContain("lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(layout).toContain('<div aria-hidden className="hidden lg:block" />');
  });

  it("one wider page container (100rem) with smaller gutters, used by the header too", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const container = css.slice(css.indexOf("@utility page-container"));
    expect(container).toContain("max-width: 100rem;");
    expect(css).toContain("padding-inline: 2.5rem;");
    expect(css).not.toContain("padding-inline: 4rem;");
    expect(readFileSync("src/components/site/Layout.tsx", "utf8")).toContain("max-w-[95rem]");
  });
});

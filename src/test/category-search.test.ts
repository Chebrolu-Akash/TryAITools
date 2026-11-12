// Search on category pages filters the tools the page already holds, with the same rule as /tools: so for any category
// and query it must return exactly what /api/search returns for that category (the JSON reader is the reference here).
import { describe, expect, it } from "vitest";
import { createJsonReader } from "@/lib/catalog/json-reader";
import { filterTools, MAX_QUERY, normalizeToolsQuery } from "@/lib/catalog/views";

describe("category page search", () => {
  const reader = createJsonReader();

  it("returns exactly the /tools search results for the same category and query", async () => {
    const { categories } = await reader.summary();
    for (const c of categories) {
      const page = await reader.categoryPage(c.slug);
      expect(page, c.slug).not.toBeNull();
      for (const raw of ["", "a", "AI", "Chat", "video", ".com", "writing assistant", "zz-none"]) {
        const q = normalizeToolsQuery({ q: raw }).q;
        const mine = filterTools(page!.tools, "", q).map((t) => t.slug);
        const all: string[] = [];
        for (let p = 1; ; p++) {
          const r = await reader.toolsPage(
            normalizeToolsQuery({ q: raw, category: c.slug, page: p }),
          );
          all.push(...r.items.map((t) => t.slug));
          if (all.length >= r.total || r.items.length === 0) break;
        }
        expect(mine, `${c.slug} q=${raw}`).toEqual(all);
      }
    }
  });

  it("works together with the subcategory filter and matches name, use case and website", async () => {
    const page = (await reader.categoryPage("ai-writing-tools"))!;
    const sub = page.category.subcategories[0]!;
    const inSub = filterTools(page.tools, sub, "");
    expect(inSub.length).toBeGreaterThan(0);
    expect(inSub.every((t) => t.subcategory === sub)).toBe(true);
    const t = inSub[0]!;
    const byName = normalizeToolsQuery({ q: t.name.toUpperCase().slice(0, 4) }).q;
    expect(filterTools(page.tools, sub, byName).map((x) => x.slug)).toContain(t.slug);
    const bySub = normalizeToolsQuery({ q: sub.replace(/^AI /, "") }).q;
    expect(filterTools(page.tools, "", bySub).length).toBeGreaterThanOrEqual(inSub.length);
    if (t.url) {
      const host = new URL(t.url).hostname.replace(/^www\./, "");
      expect(filterTools(page.tools, "", host).map((x) => x.slug)).toContain(t.slug);
    }
    expect(filterTools(page.tools, sub, "zz-no-such-tool")).toEqual([]); // the "no matching tools" state
    expect(filterTools(page.tools, "", "")).toHaveLength(page.tools.length); // no filter: everything
  });

  it("long queries are cut to the same limit as /tools", () => {
    expect(normalizeToolsQuery({ q: "x".repeat(500) }).q).toHaveLength(MAX_QUERY);
  });
});

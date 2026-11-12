import { describe, expect, it } from "vitest";
import { normalizeToolsQuery } from "@/lib/catalog/views";
import { searchPage, type SearchList } from "@/static/search";
import { matchesTag, tagFromSlug, tagSlug, tagsOf, TOOL_TAGS } from "@/lib/tags";

describe("functional tags", () => {
  it("round-trips every tag through its URL value", () => {
    for (const t of TOOL_TAGS) expect(tagFromSlug(tagSlug(t))).toBe(t);
    expect(tagSlug("Sales & CRM")).toBe("sales-crm");
    expect(tagFromSlug("not-a-tag")).toBeNull();
  });

  it("keeps only vocabulary tags, in vocabulary order", () => {
    expect(tagsOf('["SEO","made up","AI Writing"]')).toEqual(["AI Writing", "SEO"]);
    expect(tagsOf("not json")).toEqual([]);
    expect(tagsOf(null)).toEqual([]);
    expect(matchesTag(["SEO"], "SEO")).toBe(true);
    expect(matchesTag(undefined, "SEO")).toBe(false);
    expect(matchesTag(undefined, null)).toBe(true);
  });

  it("normalises the tag filter and the static search applies it", () => {
    expect(normalizeToolsQuery({ tag: "ai-writing" }).tag).toBe("ai-writing");
    expect(normalizeToolsQuery({ tag: "<script>" }).tag).toBe("");
    const list: SearchList = {
      categories: [{ slug: "ai-writing-tools", name: "AI Writing Tools" }],
      tools: [
        [
          "a",
          "Alpha",
          "https://a.example",
          "ai-writing-tools",
          "AI Writing Assistants",
          0,
          "1",
          "freemium",
          ["AI Writing", "SEO"],
        ],
        [
          "b",
          "Beta",
          "https://b.example",
          "ai-writing-tools",
          "AI Writing Assistants",
          1,
          "2",
          "",
          ["AI Writing"],
        ],
        ["c", "Gamma", "https://c.example", "ai-writing-tools", "AI Writing Assistants", 2, "3"],
      ],
    };
    const seo = searchPage(list, normalizeToolsQuery({ tag: "seo" }), 48);
    expect(seo.items.map((t) => t.slug)).toEqual(["a"]);
    expect(seo.items[0]?.tags).toEqual(["AI Writing", "SEO"]);
    const all = searchPage(list, normalizeToolsQuery({}), 48);
    expect(all.total).toBe(3);
    expect(all.items[2]?.tags).toBeUndefined();
    const both = searchPage(
      list,
      normalizeToolsQuery({ tag: "ai-writing", pricing: "freemium" }),
      48,
    );
    expect(both.items.map((t) => t.slug)).toEqual(["a"]);
  });
});

// @vitest-environment node
// Technical SEO details: titles stay within ~60 characters without rewording, counts never overstate, /tools and
// /categories carry breadcrumbs, and AI News Article data includes the verified article image.
import { describe, expect, it } from "vitest";

import { newsArticleHead, newsListHead } from "@/lib/news/seo";
import type { NewsDetail } from "@/lib/news/model";
import { countLabel, titleWithSite } from "@/lib/site";
import { Route as CategoriesRoute } from "@/routes/categories.index";
import { Route as HomeRoute } from "@/routes/index";
import { Route as ToolsRoute } from "@/routes/tools.index";

type Head = { meta: Record<string, string>[]; links?: unknown[]; scripts?: { children: string }[] };
const head = (route: { options: { head?: unknown } }, loaderData: unknown) =>
  (route.options.head as (c: unknown) => Head)({ loaderData, params: {} });
const meta = (h: Head, k: string, v: string) => h.meta.find((m) => m[k] === v);
const ld = (h: Head) => JSON.parse(h.scripts?.[0]?.children ?? "null");

const article = (o: Partial<NewsDetail> = {}): NewsDetail => ({
  slug: "nvidia-introduces-vera-cpu-1a9b5a",
  title: "NVIDIA Introduces Vera CPU for High-Throughput AI Agents",
  description: "NVIDIA announced the Vera CPU for AI agent workloads.",
  category: "model-releases",
  sourceName: "NVIDIA",
  imageUrl: "https://blogs.nvidia.com/wp-content/uploads/2026/11/vera.png",
  publishedAt: "2026-11-05T20:00:41.000Z",
  sourcePublishedAt: "2026-11-05T20:00:41.000Z",
  featured: false,
  summary: "A summary.",
  takeaways: [],
  tags: [],
  companies: [],
  products: [],
  canonicalUrl: "https://blogs.nvidia.com/blog/vera/",
  sourceSiteUrl: null,
  collectedAt: "2026-11-05T21:00:00.000Z",
  updatedAt: "2026-11-06T03:00:41.848Z",
  ...o,
});

describe("technical SEO", () => {
  it("titleWithSite adds the site name only while the title fits; the title itself is never changed", () => {
    expect(titleWithSite("Privacy Policy")).toBe("Privacy Policy | TryAITools");
    const long = "NVIDIA Introduces Vera CPU for High-Throughput AI Agents";
    expect(titleWithSite(long)).toBe(long);
  });

  it("countLabel never overstates the number of tools", () => {
    expect(countLabel(1870)).toBe("1,800+");
    expect(countLabel(2225)).toBe("2,200+");
    expect(countLabel(95)).toBe("95");
  });

  it("home and /tools use the live count instead of a hard-coded 2,000", () => {
    const home = head(HomeRoute, { toolCount: 1870, categories: [], featured: [] });
    expect(home.meta.find((m) => m["title"])!["title"]).toBe(
      "TryAITools — Discover 1,800+ AI Tools by Category",
    );
    const tools = head(ToolsRoute, { total: 1870, items: [] });
    expect(meta(tools, "name", "description")!["content"]).toMatch(
      /^Search and filter 1,800\+ AI tools/,
    );
  });

  it("/tools and /categories carry BreadcrumbList structured data and fuller descriptions", () => {
    const t = ld(head(ToolsRoute, { total: 1870, items: [] }));
    expect(t["@type"]).toBe("BreadcrumbList");
    expect(t.itemListElement.map((i: { item: string }) => i.item)).toEqual([
      "https://tryaitools.io/",
      "https://tryaitools.io/tools",
    ]);
    const c = head(CategoriesRoute, { categories: Array.from({ length: 15 }), toolCount: 1870 });
    expect(ld(c).itemListElement[1].item).toBe("https://tryaitools.io/categories");
    const desc = meta(c, "name", "description")!["content"]!;
    expect(desc.length).toBeGreaterThanOrEqual(120);
    expect(desc).toMatch(/^Explore 15 AI tool categories/);
  });

  it("an AI News article's Article data and og:image use its verified image; none is invented when it has no image", () => {
    const h = newsArticleHead(article()) as unknown as Head;
    const graph = ld(h)["@graph"];
    const node = graph.find((n: { "@type": string }) => n["@type"] === "Article");
    expect(node.image).toBe("https://blogs.nvidia.com/wp-content/uploads/2026/11/vera.png");
    expect(meta(h, "property", "og:image")!["content"]).toBe(
      "https://blogs.nvidia.com/wp-content/uploads/2026/11/vera.png",
    );
    // the long headline is kept word for word; only the site suffix is dropped
    expect(h.meta.find((m) => m["title"])!["title"]).toBe(
      "NVIDIA Introduces Vera CPU for High-Throughput AI Agents",
    );
    const none = newsArticleHead(article({ imageUrl: null })) as unknown as Head;
    expect(
      ld(none)["@graph"].find((n: { "@type": string }) => n["@type"] === "Article").image,
    ).toBeUndefined();
    expect(meta(none, "property", "og:image")!["content"]).toBe(
      "https://tryaitools.io/og-image.png",
    );
  });

  it("an AI News article has exactly one Article node; its TryAITools author and publisher both carry the site url", () => {
    const h = newsArticleHead(article()) as unknown as Head;
    const graph = ld(h)["@graph"];
    const nodes = graph.filter((n: { "@type": string }) => n["@type"] === "Article");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].author).toEqual({
      "@type": "Organization",
      name: "TryAITools",
      url: "https://tryaitools.io/",
    });
    expect(nodes[0].publisher).toEqual({
      "@type": "Organization",
      name: "TryAITools",
      url: "https://tryaitools.io/",
    });
  });

  it("AI News listings carry a BreadcrumbList; search results and empty listings carry none", () => {
    const hub = newsListHead({ category: null, q: "", page: 1, count: 12 }) as unknown as Head;
    expect(ld(hub).itemListElement.map((i: { item: string }) => i.item)).toEqual([
      "https://tryaitools.io/",
      "https://tryaitools.io/news",
    ]);
    const cat = newsListHead({ category: "research", q: "", page: 1, count: 3 }) as unknown as Head;
    const items = ld(cat).itemListElement;
    expect(items).toHaveLength(3);
    expect(items[2].item).toBe("https://tryaitools.io/news/category/research");
    expect(
      (newsListHead({ category: null, q: "ai", page: 1, count: 5 }) as unknown as Head).scripts,
    ).toBeUndefined();
    expect(
      (newsListHead({ category: "research", q: "", page: 1, count: 0 }) as unknown as Head).scripts,
    ).toBeUndefined();
  });
});

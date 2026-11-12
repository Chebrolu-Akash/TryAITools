// Head tags shared by every route (src/lib/seo.ts): one canonical on the production host, matching og:url; "not found"
// pages are noindex and claim no canonical.
import { describe, expect, it } from "vitest";
import { pageHead } from "@/lib/seo";

const metas = (h: ReturnType<typeof pageHead>, key: "name" | "property", value: string) =>
  h.meta.filter((m) => (m as Record<string, string>)[key] === value);

describe("pageHead", () => {
  it("a normal page: one canonical on https://tryaitools.io, og:url equal to it, no robots tag", () => {
    const h = pageHead({ title: "T", description: "D", path: "/tools/claude" });
    expect(h.links).toEqual([{ rel: "canonical", href: "https://tryaitools.io/tools/claude" }]);
    expect(metas(h, "property", "og:url")).toEqual([
      { property: "og:url", content: "https://tryaitools.io/tools/claude" },
    ]);
    expect(metas(h, "name", "robots")).toEqual([]);
    for (const k of ["og:title", "og:description", "og:image", "og:type"])
      expect(metas(h, "property", k).length, k).toBe(1);
    for (const k of ["description", "twitter:card", "twitter:title", "twitter:description"])
      expect(metas(h, "name", k).length, k).toBe(1);
  });

  it("a noindex listing keeps its own canonical (noindex, follow)", () => {
    const h = pageHead({ title: "T", description: "D", path: "/tools/x", noindex: true });
    expect(h.links).toHaveLength(1);
    expect(metas(h, "name", "robots")).toEqual([{ name: "robots", content: "noindex, follow" }]);
  });

  it("a not-found page: noindex, no canonical, no og:url", () => {
    const h = pageHead({
      title: "T",
      description: "D",
      path: "/tools/x",
      noindex: true,
      canonical: false,
    });
    expect(h.links).toEqual([]);
    expect(metas(h, "property", "og:url")).toEqual([]);
    expect(metas(h, "name", "robots")).toHaveLength(1);
  });
});

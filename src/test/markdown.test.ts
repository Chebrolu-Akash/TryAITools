// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMarkdown, safeHref, type Block, type Inline } from "@/lib/markdown";

const flat = (n: Inline[]): Inline[] =>
  n.flatMap((i) => (i.t === "strong" || i.t === "em" || i.t === "link" ? [i, ...flat(i.c)] : [i]));
const inlines = (bs: Block[]): Inline[] =>
  bs.flatMap((b) => ("c" in b ? flat(b.c) : "items" in b ? b.items.flatMap(flat) : []));
const links = (md: string) =>
  inlines(parseMarkdown(md)).filter((i): i is Extract<Inline, { t: "link" }> => i.t === "link");
const textOf = (md: string) =>
  inlines(parseMarkdown(md))
    .map((i) => (i.t === "text" || i.t === "code" ? i.v : ""))
    .join("");

describe("markdown: structure", () => {
  it("parses headings (clamped to h2+), paragraphs, lists, quotes, rules and code fences", () => {
    const b = parseMarkdown(
      "# Title\n\nHello **bold** and *it* and `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n> quote\n\n---\n\n```\nraw <b>\n```",
    );
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol", "quote", "hr", "code"]);
    expect((b[0] as { level: number }).level).toBe(2);
    expect((b[6] as { v: string }).v).toBe("raw <b>");
    expect((b[2] as { items: unknown[] }).items.length).toBe(2);
  });
  it("caps input length and nesting so a hostile post cannot hang the editor", () => {
    expect(parseMarkdown("a".repeat(500_000)).length).toBe(1);
    expect(() => parseMarkdown("*".repeat(50_000) + "[".repeat(50_000))).not.toThrow();
  });
});

describe("markdown: XSS safety", () => {
  it("never interprets raw HTML: it stays literal text", () => {
    const t = textOf(
      '<script>alert(1)</script> <img src=x onerror="alert(1)"> <a href="javascript:alert(1)">x</a>',
    );
    expect(t).toContain("<script>alert(1)</script>");
    expect(t).toContain("<img src=x onerror=");
    expect(parseMarkdown("<script>alert(1)</script>").every((b) => b.t === "p")).toBe(true);
  });
  it("drops javascript:, data:, vbscript: and obfuscated URLs, keeping only the label", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.test/x",
      "/\\evil.test/x",
      "ftp://x.test",
    ]) {
      expect(links(`[click](${bad})`), bad).toEqual([]);
      expect(textOf(`[click](${bad})`), bad).toBe("click");
    }
  });
  it("allows http(s), mailto and same-site paths, and emits the normalized href", () => {
    expect(links("[a](https://example.com/p?q=1)")[0]).toMatchObject({
      href: "https://example.com/p?q=1",
      external: true,
    });
    expect(links("[a](mailto:hi@example.com)")[0].href).toBe("mailto:hi@example.com");
    expect(links("[a](/tools/chatgpt)")[0]).toMatchObject({
      href: "/tools/chatgpt",
      external: false,
    });
  });
  it("cannot break out of the href attribute with quotes", () => {
    const l = links('[a](https://example.com/" onmouseover="alert(1))');
    expect(l.length === 0 || !/[" ]onmouseover/.test(l[0].href.replace(/%22|%20/g, ""))).toBe(true);
    expect(l.every((x) => !x.href.includes('"'))).toBe(true);
  });
  it("rejects credentials in URLs", () =>
    expect(links("[a](https://user:pw@example.com)")).toEqual([]));
  it("does not support images", () =>
    expect(
      inlines(parseMarkdown("![x](https://e.com/a.png)")).some(
        (i) => (i as { t: string }).t === "img",
      ),
    ).toBe(false));
  it("safeHref returns null for empty and oversized input", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref("https://e.com/" + "a".repeat(3000))).toBeNull();
  });
});

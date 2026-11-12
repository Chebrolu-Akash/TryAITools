// The approved redesign's global changes: card buttons, names without the "AI" prefix, the category sidebar data and the
// new main navigation.
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCard } from "@/components/site/ToolCard";
import { createJsonReader } from "@/lib/catalog/json-reader";
import { dropAI } from "@/lib/tool-utils";

afterEach(cleanup);

describe("redesign", () => {
  it("tool cards: Explore opens the tool page, TryAI (no arrow) opens the tool's website", () => {
    render(
      <ToolCard
        tool={{
          slug: "chatgpt",
          name: "ChatGPT",
          url: "https://chat.openai.com",
          category: "AI Writing Tools",
          categorySlug: "ai-writing-tools",
          subcategory: "AI Writing Assistants",
        }}
      />,
    );
    const explore = screen.getByRole("link", { name: "Explore" });
    expect(explore.getAttribute("href")).toBe("/tools/chatgpt");
    const tryLink = screen.getByRole("link", { name: /^TryAI: open ChatGPT/ });
    expect(tryLink.textContent).toBe("TryAI");
    expect(tryLink.getAttribute("rel")).toContain("noopener");
    expect(tryLink.getAttribute("href")).toBe("https://chat.openai.com");
    expect(tryLink.getAttribute("target")).toBe("_blank");
    expect(tryLink.querySelector("svg")).toBeNull();
    expect(screen.queryByText("View Details")).toBeNull();
    expect(screen.getByText("Writing Assistants")).toBeTruthy(); // no "AI" prefix
  });

  it("dropAI removes only a leading AI", () => {
    expect(dropAI("AI Blog Writing Tools")).toBe("Blog Writing Tools");
    expect(dropAI("Writing Assistants")).toBe("Writing Assistants");
    expect(dropAI("OpenAI Tools")).toBe("OpenAI Tools");
  });

  it("the category page carries every published category with its tool count (sidebar)", async () => {
    const reader = createJsonReader();
    const { categories, toolCount } = await reader.summary();
    const page = (await reader.categoryPage("ai-writing-tools"))!;
    expect(page.categories.map((c) => c.slug)).toEqual(categories.map((c) => c.slug));
    expect(page.categories.reduce((s, c) => s + c.toolCount, 0)).toBe(toolCount);
    expect(page.categories.find((c) => c.slug === "ai-writing-tools")!.toolCount).toBe(
      page.tools.length,
    );
  });

  it("main navigation: AI Tools, AI News, AI Learning Hub, AI Gadgets, Guest Articles, Blog, AI Agents", () => {
    const layout = readFileSync("src/components/site/Layout.tsx", "utf8");
    const nav = layout.slice(layout.indexOf("const nav = ["), layout.indexOf("] as const;"));
    const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([
      "AI Tools",
      "AI News",
      "AI Learning Hub",
      "AI Gadgets",
      "Guest Articles",
      "Blog",
      "AI Agents",
    ]);
    expect(layout).not.toContain("Explore Tools");
    for (const p of ["learn.courses", "learn.books", "learn.tutorials"])
      expect(readFileSync(`src/routes/${p}.index.tsx`, "utf8")).toContain(
        "loaderData?.items.length ?? 0",
      );
    for (const p of ["gadgets", "guest-articles", "blog"])
      // a section page is noindex while it has no published entries
      expect(readFileSync(`src/routes/${p}.index.tsx`, "utf8")).toContain(
        "noindex: !loaderData?.items.length",
      );
  });
});

// The AI News listing layout: hero, story hierarchy, search results, sidebar and branded fallback artwork.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsImage, NewsListing } from "@/components/site/NewsViews";
import { readMinutes } from "@/lib/news/reader";
import type { NewsCard, NewsCategory } from "@/lib/news/model";

// The site chrome needs the router; the listing itself does not.
vi.mock("@/components/site/Layout", () => ({
  Page: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

const story = (i: number, o: Partial<NewsCard> = {}): NewsCard => ({
  slug: `story-${i}`,
  title: `Story number ${i}`,
  description: `Description ${i}.`,
  category: "research",
  sourceName: "NVIDIA",
  imageUrl: `https://blogs.nvidia.com/wp-content/uploads/2026/11/${i}.jpg`,
  publishedAt: new Date(Date.UTC(2026, 10, 18, 12 - i)).toISOString(),
  sourcePublishedAt: null,
  featured: false,
  readMinutes: 1,
  ...o,
});
const stories = (n: number, o: Partial<NewsCard> = {}) =>
  Array.from({ length: n }, (_, i) => story(i, o));

const listing = (p: Partial<Parameters<typeof NewsListing>[0]> = {}) =>
  render(
    <NewsListing
      category={null}
      items={stories(12)}
      trending={stories(5)}
      latest={stories(18)}
      counts={{ research: 18 }}
      page={1}
      hasMore
      q=""
      {...p}
    />,
  ).container;

const articleLinks = (el: Element) =>
  [...el.querySelectorAll("a")]
    .map((a) => a.getAttribute("href")!)
    .filter((h) => /^\/news\/story-/.test(h));

describe("AI News listing", () => {
  it("first page: hero with a Read article link, then top stories, the grid and the river; every story once", () => {
    const c = listing();
    const hero = c.querySelector('[aria-labelledby="top-story"]')!;
    expect(hero.textContent).toContain("Story number 0");
    expect(hero.textContent).toContain("Read article");
    expect(hero.querySelector('a[href="/news/story-0"]')).not.toBeNull();
    expect(c.querySelector("#top-stories")).not.toBeNull();
    expect(c.querySelector("#latest-heading")).not.toBeNull();
    const shown = new Set(
      [...c.querySelectorAll("article")]
        .filter((a) => !a.closest("aside"))
        .map((a) => a.querySelector("h2 a, h3 a")!.getAttribute("href")),
    );
    expect([...shown].sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `/news/story-${i}`).sort(),
    );
    // Pagination keeps rel=next
    expect(c.querySelector('a[rel="next"]')!.getAttribute("href")).toBe("/news?page=2");
  });

  it("an editor's pick becomes the hero", () => {
    const items = stories(12);
    items[5] = { ...items[5]!, featured: true };
    const hero = listing({ items }).querySelector('[aria-labelledby="top-story"]')!;
    expect(hero.textContent).toContain("Story number 5");
  });

  it("search results: no hero, a result count, a compact list and the query kept in the box", () => {
    const c = listing({ q: "agent", items: stories(3), hasMore: false });
    expect(c.querySelector('[aria-labelledby="top-story"]')).toBeNull();
    expect(c.textContent).toContain("Results for “agent”");
    expect(c.textContent).toContain("3 stories across all categories");
    expect((c.querySelector('input[name="q"]') as HTMLInputElement).value).toBe("agent");
    const clear = [...c.querySelectorAll("a")].find((a) => a.textContent === "Clear search")!;
    expect(clear.getAttribute("href")).toBe("/news");
  });

  it("category page: active tab and sidebar entry, search scoped to the category", () => {
    const c = listing({ category: "research" });
    const active = [...c.querySelectorAll('a[aria-current="page"]')].map((a) =>
      a.getAttribute("href"),
    );
    expect(active).toEqual(["/news/category/research", "/news/category/research"]);
    expect(c.querySelector('form[role="search"]')!.getAttribute("action")).toBe(
      "/news/category/research",
    );
    expect(c.querySelector("h1")!.textContent).toBe("Research — AI News");
  });

  it("all seven category chips are present (original masthead)", () => {
    const tabs = listing().querySelector('nav[aria-label="News categories"]')!;
    expect([...tabs.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "All news",
      "Model Releases",
      "Tool Launches",
      "Company News",
      "Research",
      "Business & Funding",
      "Regulation & Policy",
    ]);
  });

  it("a quiet category with one story continues with the latest from other categories", () => {
    const others = stories(18).map((n) => ({ ...n, slug: `other-${n.slug}` }));
    const c = listing({
      category: "business-funding",
      items: [story(0)],
      latest: others,
      hasMore: false,
    });
    expect(c.querySelector("#across-news")).not.toBeNull();
    expect(articleLinks(c.querySelector("#across-news")!.closest("section")!)).toHaveLength(0);
    expect(
      c.querySelector("#across-news")!.closest("section")!.querySelectorAll("article"),
    ).toHaveLength(4);
  });

  it("the sidebar lists trending, categories with real counts and latest updates not already on the page", () => {
    const c = listing();
    expect(c.querySelector("#trending-heading")).not.toBeNull();
    const cats = c.querySelector('[aria-labelledby="categories-heading"]')!;
    expect(cats.textContent).toContain("Research18");
    const latest = c.querySelector('[aria-labelledby="latest-updates-heading"]')!;
    expect(latest.textContent).toContain("Earlier updates");
    expect(articleLinks(latest)).toEqual(
      Array.from({ length: 6 }, (_, i) => `/news/story-${i + 12}`),
    );
  });

  it("no hard-coded stories: an empty listing shows the empty state", () => {
    const c = listing({ items: [], trending: [], latest: [], hasMore: false });
    expect(c.textContent).toContain("No news here yet");
    expect(c.querySelectorAll("article")).toHaveLength(0);
  });
});

describe("AI News fallback artwork", () => {
  const frame = (category: NewsCategory, seed: string) =>
    render(<NewsImage src={null} category={category} seed={seed} className="aspect-[16/9]" />)
      .container.firstElementChild!;

  it("is abstract (no <img>) with a palette per category", () => {
    const a = frame("research", "x");
    const b = frame("business-funding", "x");
    expect(a.querySelector("img")).toBeNull();
    expect(a.className).not.toBe(b.className);
  });

  it("varies the pattern by story so neighbouring placeholders differ", () => {
    const patterns = new Set(
      Array.from({ length: 12 }, (_, i) => frame("research", `story-${i}`).innerHTML),
    );
    // Four patterns (jsdom drops the glow's gradient style, which varies too in a browser).
    expect(patterns.size).toBeGreaterThanOrEqual(3);
  });
});

describe("reading time", () => {
  it("rounds the summary length to whole minutes, at least one; none for an empty summary", () => {
    expect(readMinutes(0)).toBeNull();
    expect(readMinutes(500)).toBe(1);
    expect(readMinutes(6 * 220 * 3)).toBe(3);
  });
});

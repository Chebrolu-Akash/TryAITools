// AI News images in the browser: the branded placeholder is always there, an image that fails is removed (never a
// broken-image icon), and cards keep a fixed 16:9 frame with or without an image.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { NewsCardView, NewsImage } from "@/components/site/NewsViews";
import { relativeAge, type NewsCard } from "@/lib/news/model";

afterEach(cleanup);

const card = (o: Partial<NewsCard> = {}): NewsCard => ({
  slug: "a-story-abc123",
  title: "A story about a model",
  description: "A short description.",
  category: "research",
  sourceName: "NVIDIA",
  imageUrl: "https://blogs.nvidia.com/wp-content/uploads/2026/10/hero.jpg",
  publishedAt: "2026-11-01T00:00:00.000Z",
  sourcePublishedAt: null,
  featured: false,
  ...o,
});

describe("AI News images", () => {
  it("shows the image over the placeholder in a fixed 16:9 frame", () => {
    const { container } = render(<NewsCardView n={card()} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(card().imageUrl);
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    const frame = img.parentElement!;
    expect(frame.className).toContain("aspect-[16/9]");
    expect(frame.querySelector("svg")).not.toBeNull(); // placeholder icon underneath
  });

  it("removes an image that fails to load and keeps the branded placeholder", () => {
    const { container } = render(<NewsCardView n={card()} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    const frame = container.querySelector("article > div")!;
    expect(frame.className).toContain("aspect-[16/9]");
    expect(frame.className).toContain("bg-gradient-to-br");
    expect(frame.querySelector("svg")).not.toBeNull();
  });

  it("an article without an image gets the same placeholder frame on cards and as the article hero", () => {
    const { container } = render(<NewsCardView n={card({ imageUrl: null })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("article > div")!.className).toContain("aspect-[16/9]");
    cleanup();
    // The article page's hero (same component, larger icon).
    const hero = render(
      <NewsImage src={null} className="aspect-[16/9] max-h-[26rem] w-full" eager large />,
    ).container.firstElementChild!;
    expect(hero.querySelector("img")).toBeNull();
    expect(hero.className).toContain("aspect-[16/9]");
    expect(hero.querySelector("svg")).not.toBeNull();
  });

  it("an image that already failed before hydration is removed on mount", () => {
    const desc = Object.getOwnPropertyDescriptors(HTMLImageElement.prototype);
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 0,
    });
    try {
      const { container } = render(<NewsCardView n={card()} />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("svg")).not.toBeNull();
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "complete", desc.complete!);
      Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", desc.naturalWidth!);
    }
  });
});

describe("AI News card dates and layout", () => {
  const NOW = Date.parse("2026-11-02T12:00:00.000Z");

  it("relativeAge: minutes, hours, Yesterday, days; nothing for old, future or invalid dates", () => {
    const ago = (ms: number) => relativeAge(new Date(NOW - ms).toISOString(), NOW);
    expect(ago(20_000)).toBe("Just now");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(45 * 60_000)).toBe("45 minutes ago");
    expect(ago(2 * 3600_000)).toBe("2 hours ago");
    expect(ago(30 * 3600_000)).toBe("Yesterday");
    expect(ago(4 * 86400_000)).toBe("4 days ago");
    expect(ago(8 * 86400_000)).toBeNull(); // older: the calendar date alone
    expect(ago(-2 * 3600_000)).toBeNull(); // a future timestamp is never "ago"
    expect(relativeAge("not a date", NOW)).toBeNull();
  });

  it("shows the source's publication date with the relative age, in a <time> element", () => {
    const published = new Date(Date.now() - 3 * 3600_000).toISOString();
    const { container } = render(<NewsCardView n={card({ sourcePublishedAt: published })} />);
    const time = container.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe(published);
    expect(time.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} · 3 hours ago$/);
    expect(time.getAttribute("title")).toBe("Published by the source");
  });

  it("labels the date 'Added' when the feed gave no publication date, and shows no age for old news", () => {
    const { container } = render(
      <NewsCardView
        n={card({ sourcePublishedAt: null, publishedAt: "2026-01-15T08:00:00.000Z" })}
      />,
    );
    expect(container.querySelector("time")!.textContent).toBe("Added Jan 15, 2026");
  });

  it("the server render has no relative age (pages are pre-built; the age is added in the browser)", () => {
    const html = renderToString(
      <NewsCardView n={card({ sourcePublishedAt: new Date().toISOString() })} />,
    );
    expect(html).not.toMatch(/ago|Just now/);
  });

  it("a wide card spans both columns with the lead layout", () => {
    const wide = render(<NewsCardView n={card()} wide />).container.querySelector("article")!;
    expect(wide.className).toContain("sm:col-span-2");
    expect(wide.className).toContain("md:grid-cols-2");
    cleanup();
    const normal = render(<NewsCardView n={card()} />).container.querySelector("article")!;
    expect(normal.className).not.toContain("col-span-2");
  });
});

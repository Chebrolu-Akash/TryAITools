// @vitest-environment jsdom
// Multi-selection in Admin > Tools: row and page checkboxes, selection kept across pages and filters, "select all
// matching" across every page, select by slugs, clear, the selected count, the bulk actions it unlocks, and restoring
// the selection after a browser refresh (sessionStorage).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolsList } from "@/components/admin/ToolsList";

const ALL = Array.from({ length: 60 }, (_, i) => ({
  id: `t${i + 1}`,
  slug: `tool-${i + 1}`,
  name: `Tool ${i + 1}`,
  url: `https://t${i + 1}.example.com`,
  category_name: i % 2 ? "Writing" : "Video",
  category_id: i % 2 ? "writing" : "video",
  subcategory: null,
  status: "published",
  indexing: "noindex",
  needs_review: 0,
  import_issue: null,
  review_status: "unreviewed",
  updated_at: "2026-11-08T00:00:00.000Z",
}));

describe("admin tools multi-selection", () => {
  let gets: string[];
  beforeEach(() => {
    gets = [];
    sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const u = new URL(input, "https://admin.test");
        gets.push(u.pathname + u.search);
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
        if (u.pathname.endsWith("/categories"))
          return json({
            items: [
              { id: "writing", name: "Writing", subcategories: [] },
              { id: "video", name: "Video", subcategories: [] },
            ],
          });
        if (u.pathname.endsWith("/bulk/operations")) return json({ items: [] });
        const cat = u.searchParams.get("category");
        const rows = ALL.filter((t) => !cat || t.category_id === cat);
        if (u.pathname.endsWith("/bulk/select"))
          return json({ slugs: rows.map((t) => t.slug), capped: false });
        const page = Number(u.searchParams.get("page") ?? 1);
        return json({
          items: rows.slice((page - 1) * 25, page * 25),
          total: rows.length,
          page,
          pageSize: 25,
        });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const count = () => screen.getByText(/selected$/).textContent;
  const nav = () => {};

  it("row and page checkboxes, kept across pages and filters, then cleared", async () => {
    render(<ToolsList nav={nav} initial={{}} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Tool 1" }));
    expect(count()).toBe("1 selected");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all tools on this page" }));
    expect(count()).toBe("25 selected");
    // page 2: the selection survives, and its page box starts unticked
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("checkbox", { name: "Select Tool 26" });
    expect(count()).toBe("25 selected");
    expect(
      (screen.getByRole("checkbox", { name: "Select all tools on this page" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Tool 26" }));
    expect(count()).toBe("26 selected");
    // a filter change keeps the selection
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "writing" } });
    await waitFor(() => expect(gets.some((g) => g.includes("category=writing"))).toBe(true));
    expect(count()).toBe("26 selected");
    // bulk actions appear with a selection
    expect(screen.getByRole("button", { name: "Bulk edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate AI drafts (26)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(count()).toBe("0 selected");
    expect(screen.queryByRole("button", { name: "Bulk edit" })).toBeNull();
  });

  it("select all matching takes every filtered tool across all pages", async () => {
    render(<ToolsList nav={nav} initial={{}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Select all 60 matching" }));
    await waitFor(() => expect(count()).toBe("60 selected"));
    expect(gets.some((g) => g.startsWith("/api/admin/bulk/select"))).toBe(true);
  });

  it("select by slugs adds pasted slugs (commas, spaces, new lines, /tools/ prefixes)", async () => {
    render(<ToolsList nav={nav} initial={{}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Select by slugs" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Paste tool slugs/ }), {
      target: { value: "tool-3, tool-4\n/tools/tool-5  Not_A_Slug!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to selection" }));
    expect(count()).toBe("3 selected");
  });

  it("the selection survives a browser refresh (same tab)", async () => {
    const first = render(<ToolsList nav={nav} initial={{}} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Tool 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Tool 7" }));
    first.unmount(); // the page goes away…
    render(<ToolsList nav={nav} initial={{}} />); // …and comes back
    await screen.findByRole("checkbox", { name: "Select Tool 2" });
    expect(count()).toBe("2 selected");
    const row = screen.getByRole("checkbox", { name: "Select Tool 7" }) as HTMLInputElement;
    expect(row.checked).toBe(true);
    expect(within(document.body).getByRole("checkbox", { name: "Select Tool 1" })).toBeTruthy();
  });
});

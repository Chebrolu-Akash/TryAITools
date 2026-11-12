/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API fixtures */
// The tool editor must say clearly when a published tool is not indexed (not in the sitemap), because unpublish, archive
// and flag switch indexing off and publishing again does not switch it back on.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolEditor } from "@/components/admin/ToolEditor";

const tool = (over: Record<string, unknown>) => ({
  id: "t1",
  slug: "claude",
  name: "Claude",
  display_name: null,
  url: "https://claude.ai",
  category_id: "ai-writing-tools",
  category_name: "AI Writing Tools",
  subcategory: null,
  tags: [],
  status: "published",
  indexing: "noindex",
  needs_review: 0,
  import_issue: null,
  content_source: "admin",
  updated_at: "2026-10-31T00:00:00.000Z",
  ...over,
});
function mockApi(t: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("categories")
        ? {
            items: [
              {
                id: "ai-writing-tools",
                slug: "ai-writing-tools",
                name: "AI Writing Tools",
                status: "published",
                subcategories: [],
              },
            ],
          }
        : { tool: t };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("tool editor: indexing guidance", () => {
  it("a published, noindex tool shows why it is not in the sitemap and offers to allow indexing", async () => {
    mockApi(tool({}));
    render(<ToolEditor slug="claude" nav={() => {}} />);
    expect(await screen.findByText(/Published with search indexing off/)).toBeTruthy();
    expect(screen.getByText(/not in the sitemap/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow indexing" }));
    await waitFor(() =>
      expect(screen.getByText(/Indexing will be allowed when you save/)).toBeTruthy(),
    );
    const select = screen.getByLabelText(/Search indexing/) as HTMLSelectElement;
    expect(select.value).toBe("index");
  });

  it("no notice for an indexed tool or for a draft", async () => {
    mockApi(tool({ indexing: "index" }));
    render(<ToolEditor slug="claude" nav={() => {}} />);
    await screen.findByText(/Indexing: allowed/);
    expect(screen.queryByText(/Published with search indexing off/)).toBeNull();
    cleanup();
    mockApi(tool({ status: "draft" }));
    render(<ToolEditor slug="claude" nav={() => {}} />);
    await screen.findByText(/Indexing: off/);
    expect(screen.queryByText(/Published with search indexing off/)).toBeNull();
  });

  it("unpublish, archive and flag confirmations say how to get back into the sitemap", async () => {
    mockApi(tool({ indexing: "index" }));
    render(<ToolEditor slug="claude" nav={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unpublish" }));
    expect(await screen.findByText(/turn Search indexing back on/)).toBeTruthy();
  });
});

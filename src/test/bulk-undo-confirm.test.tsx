// @vitest-environment jsdom
// Undo of a bulk operation must never run on a single click: a dialog names the operation and the exact number of
// records first, and large operations also require typing "undo".
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BulkHistory } from "@/components/admin/BulkTools";

const op = (undoable: number) => ({
  id: "11111111-1111-4111-8111-111111111111",
  actor_email: "owner@example.com",
  action: "catalogue_cleanup",
  summary: "Duplicate consolidation (preview cleanup)",
  applied: undoable,
  skipped: 0,
  failed: 0,
  status: "done",
  created_at: "2026-11-08T13:35:00.000Z",
  undoable,
});

describe("bulk undo confirmation", () => {
  let posts: string[];
  let undoable = 5;
  beforeEach(() => {
    posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(url);
          return new Response(JSON.stringify({ results: [], remaining: 0 }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [op(undoable)] }), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks first, naming the operation and the exact record count; Cancel undoes nothing", async () => {
    undoable = 5;
    render(<BulkHistory onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo (5)" }));
    expect(posts).toEqual([]); // nothing sent on the first click
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain('Undo "Duplicate consolidation (preview cleanup)"?');
    expect(dialog.textContent).toContain("5 tool records");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(posts).toEqual([]);
    // confirming sends the undo
    fireEvent.click(screen.getByRole("button", { name: "Undo (5)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo 5 changes" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toContain("/bulk/operations/11111111-1111-4111-8111-111111111111/undo");
  });

  it("a large operation also requires typing 'undo' before the button works", async () => {
    undoable = 840;
    render(<BulkHistory onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo (840)" }));
    const confirm = await screen.findByRole("button", { name: "Undo 840 changes" });
    expect(screen.getByRole("alertdialog").textContent).toContain("840 tool records");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(posts).toEqual([]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "undo" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });
});

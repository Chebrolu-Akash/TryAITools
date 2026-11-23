/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed request bodies in tests */
// The review panel must send the editor's edits (not the original draft) when approving.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewDraftPanel } from "@/components/admin/ReviewDraftPanel";

const draft = {
  tagline: "Original vendor tagline for the tool",
  overview: "Overview text.",
  features: ["Reads long files.", "Answers questions.", "Writes code."],
  best_for: ["Researchers", "Developers"],
  pros: [],
  limits: [],
  pricing: { model: null, summary: "", source_url: null },
  seo_title: "Tool: AI assistant",
  seo_description: "d",
  evidence: {
    features: ["q one two", "q three four", "q five six"],
    best_for: ["q a b", "q c d"],
    pros: [],
    limits: [],
    pricing: "",
  },
  sources: [
    { url: "https://x.example/", checked_at: "2026-11-12T00:00:00Z", kind: "home", text: "t" },
  ],
  quality: {
    status: "draft_ready",
    reasons: [],
    identity: { matches: true, name_on_site: "X", reason: "" },
    dropped_ungrounded: 0,
    signals: [],
    pricing_verified: false,
  },
  model: "m",
  generated_at: "2026-11-12T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("review panel: edits reach the approval", () => {
  it("approve sends the edited tagline and feature text, and only the kept claims", async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(
          JSON.stringify(url.includes("review-history") ? { items: [] } : { ok: true }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );
    render(
      <ReviewDraftPanel
        tool={{
          slug: "x",
          updated_at: "2026-11-12T00:00:00.000Z",
          review_status: "draft_ready",
          review_draft: JSON.stringify(draft),
        }}
        onChanged={() => {}}
      />,
    );
    const tagline = (await screen.findByDisplayValue(
      "Original vendor tagline for the tool",
    )) as HTMLInputElement;
    fireEvent.change(tagline, { target: { value: "Our own wording for the tagline" } });
    fireEvent.change(screen.getByLabelText("Features 1"), {
      target: { value: "Reads very long files." },
    });
    fireEvent.click(screen.getByLabelText("Keep features 3"));
    for (const l of [
      /supported by its quote/,
      /wording is ours/,
      /Pricing confirmed/,
      /Category is right/,
    ])
      fireEvent.click(screen.getByLabelText(l));
    fireEvent.click(
      screen.getByRole("button", { name: "Approve (content goes live, still noindex)" }),
    );
    await waitFor(() => expect(calls.some((c) => c.url.includes("/draft/approve"))).toBe(true));
    const body = calls.find((c) => c.url.includes("/draft/approve"))!.body;
    expect(body.content.tagline).toBe("Our own wording for the tagline");
    expect(body.content.features).toEqual([
      { text: "Reads very long files.", ref: 0 },
      { text: "Answers questions.", ref: 1 },
    ]);
    expect(body.checklist.category_confirmed).toBe(true);
  });
});

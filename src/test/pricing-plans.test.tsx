// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON in tests */
// Detailed pricing plans (migration 0008): strict validation on save, defensive reading for display, formatting, the
// public section's wording (nothing invented), the admin save path (pricing-only saves keep the page's content source)
// and the tool page data.
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolPricingSection } from "@/components/site/ToolPricingSection";
import { handleAdminApi } from "@/lib/admin/api";
import { pricingPlansSchema, toolUpdateSchema } from "@/lib/admin/validation";
import { createD1Reader } from "@/lib/catalog/d1-reader";
import { resetVersionedCache } from "@/lib/catalog/versioned-cache";
import { formatAmount, readPricingPlans, type ToolPricing } from "@/lib/pricing-plans";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

afterEach(() => vi.restoreAllMocks());
const SPEC = JSON.parse(readFileSync("db/pricing/screenshot-plans.json", "utf8"));
const groupsOf = (product: string) => ({
  groups: SPEC.products.find((p: any) => p.product === product).groups,
});

describe("validation and reading", () => {
  it("accepts every product entered from the screenshots", () => {
    for (const p of SPEC.products) {
      const r = pricingPlansSchema.safeParse({ groups: p.groups });
      expect(r.success, `${p.product}: ${JSON.stringify(r.error?.issues?.[0])}`).toBe(true);
    }
  });

  it("refuses prices on custom plans, unknown currencies, negative amounts and unknown keys", () => {
    const plan = (o: any) => ({
      groups: [
        {
          name: "G",
          plans: [
            { name: "P", kind: "paid", from: false, prices: [], unit: null, note: null, ...o },
          ],
        },
      ],
    });
    const price = { amount: 10, currency: "USD", period: "month", billing: null };
    expect(pricingPlansSchema.safeParse(plan({})).success).toBe(true); // a paid plan without a price is allowed
    expect(pricingPlansSchema.safeParse(plan({ kind: "custom", prices: [price] })).success).toBe(
      false,
    );
    expect(
      pricingPlansSchema.safeParse(plan({ prices: [{ ...price, currency: "JPY" }] })).success,
    ).toBe(false);
    expect(pricingPlansSchema.safeParse(plan({ prices: [{ ...price, amount: -1 }] })).success).toBe(
      false,
    );
    expect(pricingPlansSchema.safeParse(plan({ price: 5 })).success).toBe(false);
    expect(pricingPlansSchema.safeParse({ groups: [] }).data).toBeNull(); // empty = none
  });

  it("reads stored JSON defensively: malformed plans are dropped, a broken record shows nothing", () => {
    expect(readPricingPlans("not json")).toBeNull();
    expect(
      readPricingPlans(
        JSON.stringify({ groups: [{ name: "X", plans: [{ name: "Bad", kind: "weird" }] }] }),
      ),
    ).toBeNull();
    const ok = readPricingPlans(
      JSON.stringify({
        groups: [
          {
            name: "Solo",
            plans: [
              {
                name: "Pro",
                kind: "paid",
                prices: [{ amount: 12, currency: "USD", period: "month", billing: "nope" }],
              },
              { name: "", kind: "free" },
            ],
          },
        ],
      }),
    );
    expect(ok).toEqual({
      groups: [
        {
          name: "Solo",
          plans: [
            {
              name: "Pro",
              kind: "paid",
              from: false,
              prices: [{ amount: 12, currency: "USD", period: "month", billing: null }],
              unit: null,
              note: null,
            },
          ],
        },
      ],
    });
  });

  it("formats amounts as written: ₹ with Indian grouping, small usage prices kept", () => {
    expect(formatAmount(7833.25, "INR")).toBe("₹7,833.25");
    expect(formatAmount(150000, "INR")).toBe("₹1,50,000");
    expect(formatAmount(20, "USD")).toBe("$20");
    expect(formatAmount(0.01, "USD")).toBe("$0.01");
    expect(formatAmount(0.25, "USD")).toBe("$0.25");
  });
});

describe("public pricing section", () => {
  const pricing = (groups: any, extra: Partial<ToolPricing> = {}): ToolPricing => ({
    plans: { groups },
    sourceUrl: "https://example.com/pricing",
    checkedAt: "2026-11-01",
    ...extra,
  });

  it("distinguishes free, paid, pay-as-you-go, custom and unspecified plans without inventing prices", () => {
    render(
      <ToolPricingSection
        name="Leonardo AI"
        pricing={pricing([
          ...groupsOf("Leonardo AI").groups,
          ...groupsOf("Murf AI").groups.slice(0, 1),
        ])}
      />,
    );
    const text = document.body.textContent!;
    expect(screen.getByRole("heading", { name: "Leonardo AI pricing" })).toBeTruthy();
    expect(text).toContain("$0/month");
    expect(text).toContain("$12/month");
    expect(text).toContain("Pricing not specified"); // API pay-as-you-go: no price shown on the page
    expect(text).toContain("Custom pricing");
    expect(text).toContain("Contact sales");
    expect(text).toContain("$0.01 per 1,000 characters");
    expect(text).toContain("Trial available"); // "Free Trial" plan, no price: no triple repetition
    expect(text).toContain("checked November 1, 2026");
    const link = screen.getByRole("link", { name: /official pricing page/ });
    expect(link.getAttribute("href")).toBe("https://example.com/pricing");
    expect(link.getAttribute("rel")).toBe("nofollow noopener noreferrer");
  });

  it("shows billing options, 'From' prices, units and yearly ₹ prices", () => {
    render(
      <ToolPricingSection
        name="Mixed"
        pricing={pricing([...groupsOf("ChatGPT").groups, ...groupsOf("Canva").groups], {
          sourceUrl: null,
          checkedAt: null,
        })}
      />,
    );
    const text = document.body.textContent!;
    expect(text).toContain("From$100/month");
    expect(text).toContain("$20/month per seat");
    expect(text).toContain("billed annually");
    expect(text).toContain("$125/month per seat");
    expect(text).toContain("billed monthly");
    expect(text).toContain("₹1,590/year");
    expect(text).toContain("₹6,800/year per person");
    expect(screen.queryByRole("link", { name: /official pricing page/ })).toBeNull(); // no source, no link
    expect(text).not.toContain("checked");
  });
});

describe("admin save and tool page data", () => {
  const NOW = 1_800_000_000;
  const ORIGIN = "https://admin.test";
  let key!: TestKey;
  let token = "";
  let db: TestDb;
  let tick = 0;
  beforeAll(async () => {
    key = await makeKey("k1");
  });
  beforeEach(async () => {
    db = createTestDb({
      seed: [
        "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('c','ai-video-tools','AI Video Tools','[\"Voice\"]',1,'published')",
        "INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,content_source,best_for,updated_at) VALUES ('t1','murf-ai','Murf AI','https://murf.ai','c','Voice','published','index',0,'curated','Old template text','2026-01-01T00:00:00.000Z')",
      ],
    });
    tick = 0;
    resetVersionedCache();
    token = await signJwt(key, goodClaims(NOW));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, {
        method,
        headers: {
          "cf-access-jwt-assertion": token,
          ...(method === "GET"
            ? {}
            : {
                "x-requested-with": "tryaitools-admin",
                origin: ORIGIN,
                "content-type": "application/json",
              }),
        },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      {
        env: async () => goodEnv,
        db: async () => db,
        now: () => `2026-11-01T10:00:${String(++tick).padStart(2, "0")}.000Z`,
        auth: { jwks: staticJwks(key), nowSeconds: NOW },
      },
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const bodyFrom = (tool: any, over: Record<string, unknown>) => {
    const keys = Object.keys((toolUpdateSchema as any).shape);
    const b: any = Object.fromEntries(keys.map((k) => [k, tool[k] ?? null]));
    if (!Array.isArray(b.tags)) b.tags = [];
    return { ...b, updated_at: tool.updated_at, ...over };
  };

  it("a pricing-only save stores the plans and keeps the page's content source; a content edit still marks it", async () => {
    const t0 = (await call("GET", "tools/murf-ai")).json.tool;
    const saved = await call(
      "PUT",
      "tools/murf-ai",
      bodyFrom(t0, {
        pricing_model: "freemium",
        pricing_source: "https://murf.ai/pricing",
        pricing_plans: groupsOf("Murf AI"),
        pricing_checked_at: "2026-11-01",
      }),
    );
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.tool.pricing_plans.groups.map((g: any) => g.name)).toEqual([
      "API",
      "Studio",
      "Dub",
    ]);
    const raw = db.raw
      .prepare(
        "SELECT content_source, best_for, pricing_checked_at FROM tools WHERE slug='murf-ai'",
      )
      .get();
    expect(raw).toEqual({
      content_source: "curated",
      best_for: "Old template text",
      pricing_checked_at: "2026-11-01",
    });

    // a new website URL (e.g. chat.openai.com -> chatgpt.com) is not a copy edit either
    const moved = await call(
      "PUT",
      "tools/murf-ai",
      bodyFrom(saved.json.tool, { url: "https://murf.ai/studio" }),
    );
    expect(moved.status).toBe(200);
    expect(
      db.raw.prepare("SELECT content_source, url FROM tools WHERE slug='murf-ai'").get(),
    ).toEqual({ content_source: "curated", url: "https://murf.ai/studio" });

    const edited = await call(
      "PUT",
      "tools/murf-ai",
      bodyFrom(moved.json.tool, { tagline: "A new tagline" }),
    );
    expect(edited.status).toBe(200);
    expect(
      db.raw.prepare("SELECT content_source FROM tools WHERE slug='murf-ai'").get().content_source,
    ).toBe("admin");
  });

  it("refuses an invalid plan with a field-level error and changes nothing", async () => {
    const t0 = (await call("GET", "tools/murf-ai")).json.tool;
    const bad = await call(
      "PUT",
      "tools/murf-ai",
      bodyFrom(t0, {
        pricing_plans: {
          groups: [
            {
              name: "API",
              plans: [
                {
                  name: "Enterprise",
                  kind: "custom",
                  from: false,
                  prices: [{ amount: 5, currency: "USD", period: null, billing: null }],
                  unit: null,
                  note: null,
                },
              ],
            },
          ],
        },
      }),
    );
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.json.error.fields)[0]).toMatch(
      /^pricing_plans\.groups\.0\.plans\.0\.prices/,
    );
    expect(
      db.raw.prepare("SELECT pricing_plans FROM tools WHERE slug='murf-ai'").get().pricing_plans,
    ).toBeNull();
  });

  it("the tool page carries the plans; a non-https source is not linked; no plans means no section", async () => {
    expect(((await createD1Reader(db).toolPage("murf-ai")) as any).pricing).toBeNull();
    db.raw
      .prepare(
        "UPDATE tools SET pricing_plans = ?, pricing_source = ?, pricing_checked_at = ? WHERE slug = 'murf-ai'",
      )
      .run(JSON.stringify(groupsOf("Murf AI")), "http://murf.ai/pricing", "2026-11-01");
    resetVersionedCache();
    const page: any = await createD1Reader(db).toolPage("murf-ai");
    expect(page.pricing.plans.groups).toHaveLength(3);
    expect(page.pricing.sourceUrl).toBeNull();
    expect(page.pricing.checkedAt).toBe("2026-11-01");
  });
});

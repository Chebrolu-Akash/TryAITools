// Detailed pricing for a tool page: plan groups (e.g. "Solo", "Team", "API"), each with plans and their prices, as an
// admin entered them from the tool's official pricing page (tools.pricing_plans, migration 0008). Nothing is inferred:
// a plan without a price shows "Pricing not specified", a custom plan shows "Custom pricing · Contact sales".
// No runtime imports: shared by the admin, the D1 reader and the public page.

export const PLAN_KINDS = ["free", "paid", "usage", "custom", "trial"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
  free: "Free",
  paid: "Paid",
  usage: "Pay-as-you-go",
  custom: "Custom",
  trial: "Free trial",
};
export const CURRENCIES = ["USD", "INR", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const PERIODS = ["month", "year"] as const;
export type Period = (typeof PERIODS)[number];
export const BILLINGS = ["annual", "monthly"] as const;
export type Billing = (typeof BILLINGS)[number];

export type PricePoint = {
  amount: number;
  currency: Currency;
  /** "per month" / "per year"; null for usage prices and one-off amounts */
  period: Period | null;
  /** how it is billed, when the page says so */
  billing: Billing | null;
};
export type Plan = {
  name: string;
  kind: PlanKind;
  /** the page says "from" (a starting price) */
  from: boolean;
  prices: PricePoint[];
  /** e.g. "per seat", "per 1,000 characters" */
  unit: string | null;
  note: string | null;
};
export type PlanGroup = { name: string; plans: Plan[] };
export type PricingPlans = { groups: PlanGroup[] };

/** What the public page receives (null when the tool has no detailed pricing). */
export type ToolPricing = {
  plans: PricingPlans;
  sourceUrl: string | null;
  checkedAt: string | null;
};

export const LIMITS = { groups: 6, plans: 12, prices: 3 } as const;

const oneOf = <T extends string>(xs: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (xs as readonly string[]).includes(v) ? (v as T) : null;
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Reads stored JSON defensively for display: anything malformed is dropped (a broken record never breaks a page).
 * The admin API validates strictly on save (src/lib/admin/validation.ts), so this is only a safety net.
 */
export function readPricingPlans(raw: unknown): PricingPlans | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const groups = (v as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) return null;
  const out: PlanGroup[] = [];
  for (const g of groups.slice(0, LIMITS.groups)) {
    const name = text((g as PlanGroup)?.name, 40);
    const plans: Plan[] = [];
    for (const p of Array.isArray((g as PlanGroup)?.plans)
      ? (g as PlanGroup).plans.slice(0, LIMITS.plans)
      : []) {
      const pname = text(p?.name, 60);
      const kind = oneOf(PLAN_KINDS, p?.kind);
      if (!pname || !kind) continue;
      const prices: PricePoint[] = [];
      for (const x of Array.isArray(p.prices) ? p.prices.slice(0, LIMITS.prices) : []) {
        const amount = Number(x?.amount);
        const currency = oneOf(CURRENCIES, x?.currency);
        if (!Number.isFinite(amount) || amount < 0 || !currency) continue;
        prices.push({
          amount,
          currency,
          period: oneOf(PERIODS, x?.period),
          billing: oneOf(BILLINGS, x?.billing),
        });
      }
      plans.push({
        name: pname,
        kind,
        from: p.from === true,
        prices,
        unit: text(p.unit, 40),
        note: text(p.note, 120),
      });
    }
    if (name && plans.length) out.push({ name, plans });
  }
  return out.length ? { groups: out } : null;
}

const SYMBOL: Record<Currency, string> = { USD: "$", INR: "₹", EUR: "€", GBP: "£" };
/** "$20", "₹7,833.25", "$0.01" (Indian digit grouping for ₹). */
export function formatAmount(amount: number, currency: Currency) {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const digits = Number.isInteger(amount)
    ? 0
    : amount < 1
      ? Math.min(4, String(amount).split(".")[1]?.length ?? 2)
      : 2;
  return `${SYMBOL[currency]}${amount.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) })}`;
}
export const periodLabel = (p: Period | null) =>
  p === "month" ? "/month" : p === "year" ? "/year" : "";
export const billingLabel = (b: Billing | null) =>
  b === "annual" ? "billed annually" : b === "monthly" ? "billed monthly" : null;

/** The headline for a plan with no price points. */
export function noPriceLabel(kind: PlanKind) {
  if (kind === "free") return "Free";
  if (kind === "trial") return "Free trial";
  if (kind === "custom") return "Custom pricing";
  return "Pricing not specified";
}

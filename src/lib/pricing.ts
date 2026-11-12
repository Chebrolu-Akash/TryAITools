// A tool's pricing model, as recorded by an admin in tools.pricing_model. Never inferred from a name, URL or free text:
// a tool without a recorded model shows no pricing tag and only appears under the "All" filter.
// No runtime imports: the static gate and the pre-render import this file directly.

export const PRICING_MODELS = ["free", "freemium", "free_trial", "paid"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const PRICING_LABELS: Record<PricingModel, string> = {
  free: "Free",
  freemium: "Freemium",
  free_trial: "Free Trial",
  paid: "Paid",
};

/** The recorded model, or null when it is missing or not one of the four known values. */
export const pricingOf = (v: unknown): PricingModel | null =>
  typeof v === "string" && (PRICING_MODELS as readonly string[]).includes(v)
    ? (v as PricingModel)
    : null;

/** Filter values for listing pages: "all" plus the four models. */
export type PricingFilter = "all" | PricingModel;
export const isPricingFilter = (v: unknown): v is PricingFilter =>
  v === "all" || pricingOf(v) !== null;

export const matchesPricing = (model: PricingModel | null | undefined, filter: PricingFilter) =>
  filter === "all" || model === filter;

/** How many tools have each model (tools without one count only towards "all"). */
export function pricingCounts(models: (PricingModel | null | undefined)[]) {
  const counts: Record<PricingFilter, number> = {
    all: models.length,
    free: 0,
    freemium: 0,
    free_trial: 0,
    paid: 0,
  };
  for (const m of models) if (m) counts[m]++;
  return counts;
}

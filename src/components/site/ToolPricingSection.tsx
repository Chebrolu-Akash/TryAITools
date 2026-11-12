import { ArrowUpRight } from "lucide-react";
import {
  billingLabel,
  formatAmount,
  noPriceLabel,
  periodLabel,
  PLAN_KIND_LABELS,
  type Plan,
  type PlanKind,
  type ToolPricing,
} from "@/lib/pricing-plans";

// A tool's pricing plans, exactly as entered from its official pricing page (src/lib/pricing-plans.ts). Nothing is
// computed or converted: currencies, periods and billing are shown as the page states them.

// Every kind uses the same neutral pill as the site's pricing badges (src/styles.css .tool-card-price).
const KIND_STYLE: Record<PlanKind, string> = {
  free: "border-slate-200 bg-white text-slate-800",
  trial: "border-slate-200 bg-white text-slate-800",
  paid: "border-slate-200 bg-white text-slate-800",
  usage: "border-slate-200 bg-white text-slate-800",
  custom: "border-slate-200 bg-white text-slate-800",
};

const fmtDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
};

function PlanPrice({ plan }: { plan: Plan }) {
  if (plan.kind === "custom")
    return (
      <div>
        <p className="text-xl font-bold">Custom pricing</p>
        <p className="text-xs text-muted-foreground">Contact sales</p>
      </div>
    );
  if (plan.prices.length === 0) {
    const label = noPriceLabel(plan.kind);
    // "Free" plan / "Free trial" plan: the name already says it, so the headline describes it instead of repeating it.
    const repeats = plan.name.trim().toLowerCase() === label.toLowerCase();
    return (
      <p
        className={
          plan.kind === "free" || plan.kind === "trial"
            ? "text-xl font-bold"
            : "text-sm font-semibold text-muted-foreground"
        }
      >
        {repeats ? (plan.kind === "free" ? "No charge" : "Trial available") : label}
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {plan.prices.map((p, i) => (
        <li key={i}>
          <span className={i === 0 ? "text-xl font-bold" : "text-base font-semibold"}>
            {plan.from && (
              <span className="mr-1 text-xs font-semibold text-muted-foreground">From</span>
            )}
            {formatAmount(p.amount, p.currency)}
          </span>
          <span className="text-sm text-muted-foreground">
            {periodLabel(p.period)}
            {plan.unit ? ` ${plan.unit}` : ""}
          </span>
          {billingLabel(p.billing) && (
            <span className="block text-xs text-muted-foreground">{billingLabel(p.billing)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Shown wherever a tool's pricing is displayed in detail (not on cards). */
export function PricingDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      Pricing information is provided for reference only and may differ from the latest prices,
      plans or offers on the official website. Please check the provider&apos;s website for the most
      up-to-date pricing.
    </p>
  );
}

export function ToolPricingSection({ name, pricing }: { name: string; pricing: ToolPricing }) {
  const many = pricing.plans.groups.length > 1;
  return (
    <section className="tool-section" aria-labelledby="pricing-h">
      <h2 id="pricing-h" className="tool-section-title">
        {name} pricing
      </h2>
      <div className="mt-4 space-y-7">
        {pricing.plans.groups.map((g) => (
          <div key={g.name}>
            {many && <h3 className="mb-3 text-base font-bold">{g.name}</h3>}
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {g.plans.map((p) => (
                <li
                  key={p.name}
                  className="flex flex-col gap-2 rounded-2xl border border-primary/10 bg-background p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold">{p.name}</h4>
                    {/* A free or trial plan without a price already says so in its headline. */}
                    {!(p.prices.length === 0 && (p.kind === "free" || p.kind === "trial")) && (
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[p.kind]}`}
                      >
                        {PLAN_KIND_LABELS[p.kind]}
                      </span>
                    )}
                  </div>
                  <PlanPrice plan={p} />
                  {p.unit && p.prices.length === 0 && p.kind !== "custom" && (
                    <p className="text-xs text-muted-foreground">{p.unit}</p>
                  )}
                  {p.note && <p className="mt-auto pt-1 text-xs text-foreground/70">{p.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Prices as shown on {name}&apos;s official pricing page
        {pricing.checkedAt ? `, checked ${fmtDate(pricing.checkedAt)}` : ""}
        {pricing.sourceUrl ? (
          <>
            {" "}
            (
            <a
              href={pricing.sourceUrl}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
            >
              official pricing page
              <ArrowUpRight aria-hidden className="h-3 w-3" />
            </a>
            )
          </>
        ) : null}
        .
      </p>
      <PricingDisclaimer className="mt-1.5" />
    </section>
  );
}

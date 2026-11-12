import { Plus, Trash2 } from "lucide-react";
import {
  BILLINGS,
  CURRENCIES,
  LIMITS,
  PERIODS,
  PLAN_KIND_LABELS,
  PLAN_KINDS,
  type Plan,
  type PlanGroup,
  type PricePoint,
  type PricingPlans,
} from "@/lib/pricing-plans";
import { btnGhost, inputCls } from "./ui";

// Detailed pricing for the tool page: groups ("Solo", "Team", "API"…) of plans, entered from the official pricing page.
// Leave a price out rather than guess it: the page then shows "Pricing not specified" (or "Custom pricing").

const newPrice = (): PricePoint => ({ amount: 0, currency: "USD", period: "month", billing: null });
const newPlan = (): Plan => ({
  name: "",
  kind: "paid",
  from: false,
  prices: [],
  unit: null,
  note: null,
});
const newGroup = (): PlanGroup => ({ name: "", plans: [newPlan()] });
const small = `${inputCls} py-1.5 text-sm`;

export function PricingPlansEditor({
  value,
  onChange,
  errors,
}: {
  value: PricingPlans | null;
  onChange: (v: PricingPlans | null) => void;
  /** API field errors, keyed like "pricing_plans.groups.0.plans.1.name" */
  errors: Record<string, string>;
}) {
  const groups = value?.groups ?? [];
  const put = (gs: PlanGroup[]) => onChange(gs.length ? { groups: gs } : null);
  const setGroup = (gi: number, g: Partial<PlanGroup>) =>
    put(groups.map((x, i) => (i === gi ? { ...x, ...g } : x)));
  const setPlan = (gi: number, pi: number, p: Partial<Plan>) =>
    setGroup(gi, { plans: groups[gi]!.plans.map((x, i) => (i === pi ? { ...x, ...p } : x)) });
  const setPrice = (gi: number, pi: number, xi: number, p: Partial<PricePoint>) =>
    setPlan(gi, pi, {
      prices: groups[gi]!.plans[pi]!.prices.map((x, i) => (i === xi ? { ...x, ...p } : x)),
    });
  const err = (path: string) => errors[`pricing_plans.${path}`];
  const groupError = errors["pricing_plans.groups"] ?? errors["pricing_plans"];

  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No detailed pricing yet. The tool page shows a pricing section once you add a group.
        </p>
      )}
      {groups.map((g, gi) => (
        <fieldset key={gi} className="rounded-2xl border border-primary/15 p-4">
          <legend className="sr-only">Pricing group {gi + 1}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[12rem] flex-1 text-sm font-semibold">
              Group name
              <input
                className={`${small} mt-1 font-normal`}
                value={g.name}
                maxLength={40}
                placeholder="e.g. Individual, Team, API"
                onChange={(e) => setGroup(gi, { name: e.target.value })}
              />
            </label>
            <button
              type="button"
              className={btnGhost}
              aria-label={`Remove group ${g.name || gi + 1}`}
              onClick={() => put(groups.filter((_, i) => i !== gi))}
            >
              <Trash2 className="h-4 w-4" /> Remove group
            </button>
          </div>
          {(err(`groups.${gi}.name`) || err(`groups.${gi}.plans`)) && (
            <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
              {err(`groups.${gi}.name`) ?? err(`groups.${gi}.plans`)}
            </p>
          )}

          <div className="mt-3 space-y-3">
            {g.plans.map((p, pi) => {
              const at = `groups.${gi}.plans.${pi}`;
              return (
                <div key={pi} className="rounded-xl border border-border bg-background p-3">
                  <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto_auto]">
                    <label className="text-xs font-semibold">
                      Plan
                      <input
                        className={`${small} mt-1 font-normal`}
                        value={p.name}
                        maxLength={60}
                        placeholder="e.g. Pro"
                        onChange={(e) => setPlan(gi, pi, { name: e.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      Kind
                      <select
                        className={`${small} mt-1 font-normal`}
                        value={p.kind}
                        onChange={(e) => {
                          const kind = e.target.value as Plan["kind"];
                          setPlan(gi, pi, { kind, ...(kind === "custom" ? { prices: [] } : {}) });
                        }}
                      >
                        {PLAN_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {PLAN_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 self-end pb-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={p.from}
                        onChange={(e) => setPlan(gi, pi, { from: e.target.checked })}
                      />
                      &ldquo;From&rdquo;
                    </label>
                    <button
                      type="button"
                      className={`${btnGhost} self-end`}
                      aria-label={`Remove plan ${p.name || pi + 1}`}
                      onClick={() => setGroup(gi, { plans: g.plans.filter((_, i) => i !== pi) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {p.kind !== "custom" &&
                    p.prices.map((x, xi) => (
                      <div
                        key={xi}
                        className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_0.8fr_1fr_1.2fr_auto]"
                      >
                        <label className="text-xs font-semibold">
                          Amount
                          <input
                            type="number"
                            min={0}
                            step="any"
                            className={`${small} mt-1 font-normal`}
                            value={Number.isFinite(x.amount) ? x.amount : ""}
                            onChange={(e) =>
                              setPrice(gi, pi, xi, { amount: e.target.valueAsNumber })
                            }
                          />
                        </label>
                        <label className="text-xs font-semibold">
                          Currency
                          <select
                            className={`${small} mt-1 font-normal`}
                            value={x.currency}
                            onChange={(e) =>
                              setPrice(gi, pi, xi, {
                                currency: e.target.value as PricePoint["currency"],
                              })
                            }
                          >
                            {CURRENCIES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold">
                          Per
                          <select
                            className={`${small} mt-1 font-normal`}
                            value={x.period ?? ""}
                            onChange={(e) =>
                              setPrice(gi, pi, xi, {
                                period: (e.target.value || null) as PricePoint["period"],
                              })
                            }
                          >
                            <option value="">(no period)</option>
                            {PERIODS.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold">
                          Billing
                          <select
                            className={`${small} mt-1 font-normal`}
                            value={x.billing ?? ""}
                            onChange={(e) =>
                              setPrice(gi, pi, xi, {
                                billing: (e.target.value || null) as PricePoint["billing"],
                              })
                            }
                          >
                            <option value="">(not stated)</option>
                            {BILLINGS.map((v) => (
                              <option key={v} value={v}>
                                {v === "annual" ? "billed annually" : "billed monthly"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={`${btnGhost} self-end`}
                          aria-label="Remove price"
                          onClick={() =>
                            setPlan(gi, pi, { prices: p.prices.filter((_, i) => i !== xi) })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  {p.kind !== "custom" && p.prices.length < LIMITS.prices && (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-primary hover:underline"
                      onClick={() => setPlan(gi, pi, { prices: [...p.prices, newPrice()] })}
                    >
                      + Add price
                    </button>
                  )}

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-semibold">
                      Unit
                      <input
                        className={`${small} mt-1 font-normal`}
                        value={p.unit ?? ""}
                        maxLength={40}
                        placeholder="e.g. per seat, per 1,000 characters"
                        onChange={(e) => setPlan(gi, pi, { unit: e.target.value || null })}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      Note
                      <input
                        className={`${small} mt-1 font-normal`}
                        value={p.note ?? ""}
                        maxLength={120}
                        placeholder="e.g. 3 seats included"
                        onChange={(e) => setPlan(gi, pi, { note: e.target.value || null })}
                      />
                    </label>
                  </div>
                  {Object.entries(errors)
                    .filter(([k]) => k.startsWith(`pricing_plans.${at}.`))
                    .slice(0, 2)
                    .map(([k, m]) => (
                      <p
                        key={k}
                        role="alert"
                        className="mt-1 text-xs font-semibold text-destructive"
                      >
                        {k.slice(`pricing_plans.${at}.`.length)}: {m}
                      </p>
                    ))}
                </div>
              );
            })}
          </div>
          {g.plans.length < LIMITS.plans && (
            <button
              type="button"
              className={`${btnGhost} mt-3`}
              onClick={() => setGroup(gi, { plans: [...g.plans, newPlan()] })}
            >
              <Plus className="h-4 w-4" /> Add plan
            </button>
          )}
        </fieldset>
      ))}
      {groupError && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {groupError}
        </p>
      )}
      {groups.length < LIMITS.groups && (
        <button type="button" className={btnGhost} onClick={() => put([...groups, newGroup()])}>
          <Plus className="h-4 w-4" /> Add pricing group
        </button>
      )}
    </div>
  );
}

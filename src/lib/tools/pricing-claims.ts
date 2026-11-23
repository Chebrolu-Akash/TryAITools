// G5: a pricing summary may only state amounts and plan names that its evidence quote (copied from the official
// pricing page) contains. The pilot drafts showed summaries adding prices or plans the quote did not support.

const PLAN_WORDS = [
  "free",
  "starter",
  "basic",
  "lite",
  "essentials",
  "standard",
  "plus",
  "pro",
  "professional",
  "premium",
  "advanced",
  "business",
  "team",
  "teams",
  "growth",
  "scale",
  "agency",
  "creator",
  "personal",
  "individual",
  "enterprise",
  "unlimited",
  "ultimate",
  "max",
];

const norm = (s: string) => s.toLowerCase().replace(/[‘’“”]/g, "'");
/** Numbers written next to a currency: $20, $1,200.50, €9, 15 USD, ₹499, 20 dollars. Returned without separators. */
export function amounts(s: string): string[] {
  const out: string[] = [];
  const re =
    /(?:[$€£₹¥]\s?(\d[\d,]*(?:\.\d+)?))|(?:(\d[\d,]*(?:\.\d+)?)\s?(?:usd|eur|gbp|inr|dollars?|euros?|pounds?)\b)/gi;
  for (const m of s.matchAll(re))
    out.push((m[1] ?? m[2] ?? "").replace(/,/g, "").replace(/\.0+$/, ""));
  return out.filter(Boolean);
}
/** Plan names: a known plan word used as a name ("Pro plan", "Business tier", "Enterprise"), case-insensitive. */
export function planNames(s: string): string[] {
  const words = norm(s).match(/[a-z]+/g) ?? [];
  return [...new Set(words.filter((w) => PLAN_WORDS.includes(w)))];
}
/** Amounts and plan names in the summary that the evidence does not contain (empty = the summary is supported). */
export function unsupportedPricingClaims(summary: string, evidence: string): string[] {
  if (!summary.trim()) return [];
  const ev = norm(evidence);
  const evAmounts = new Set(amounts(evidence));
  const evNumbers = new Set(
    (ev.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")),
  );
  const missing: string[] = [];
  for (const a of amounts(summary)) if (!evAmounts.has(a) && !evNumbers.has(a)) missing.push(a);
  const evWords = new Set(ev.match(/[a-z]+/g) ?? []);
  for (const p of planNames(summary)) if (!evWords.has(p)) missing.push(p);
  return [...new Set(missing)];
}

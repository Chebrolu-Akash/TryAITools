// Text overlap for the indexing gate (G8): a tool page may be indexed only when its own text is long enough and is not
// a near-copy of another page in the same subcategory. Pure functions; no I/O.

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

export const wordCount = (s: string) => tokens(s).length;

/** The set of 3-word sequences in a text. */
export function shingles(s: string): Set<string> {
  const w = tokens(s);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Share of `a`'s 3-word sequences that also occur in `b` (0 when `a` has none). */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / a.size;
}

/** The text a tool contributes itself (not the category template): tagline, overview, features, pros, limits, best for. */
export function ownText(t: {
  tagline?: unknown;
  overview?: unknown;
  best_for?: unknown;
  features?: unknown;
  pros?: unknown;
  limits?: unknown;
}): string {
  const list = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v !== "string" || !v.trim()) return [];
    try {
      const x = JSON.parse(v) as unknown;
      return Array.isArray(x) ? x.map(String) : [];
    } catch {
      return [];
    }
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return [
    str(t.tagline),
    str(t.overview),
    str(t.best_for),
    ...list(t.features),
    ...list(t.pros),
    ...list(t.limits),
  ]
    .filter(Boolean)
    .join("\n");
}

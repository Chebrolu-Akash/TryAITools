// Duplicate detection for collected news items, in four layers (cheapest first):
//   1. canonical URL   tracking parameters, fragments, "www." and trailing slashes removed (unique in D1)
//   2. GUID            per source (unique in D1)
//   3. headline key    lower-case words only, so punctuation/case variants collide (unique in D1)
//   4. similarity      Jaccard overlap of significant headline words against recent items, for the same story
//                      reported by two sources ("OpenAI launches X" / "OpenAI unveils X")

const TRACKING =
  /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|ocid|source|src|guccounter)$/i;

/** The URL used to recognise the same article: https, lower-case host without www, no tracking params or fragment. */
export function canonicalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.protocol = "https:";
  u.hash = "";
  u.username = "";
  u.password = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** Normalised headline: lower-case letters and digits separated by single spaces. */
export const titleKey = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 300);

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its new now of on or our over that the their this to up with via how why what will can".split(
    " ",
  ),
);
const SYNONYMS: Record<string, string> = {
  launches: "launch",
  launched: "launch",
  unveils: "launch",
  unveiled: "launch",
  introduces: "launch",
  introducing: "launch",
  announces: "launch",
  announced: "launch",
  releases: "launch",
  released: "launch",
  debuts: "launch",
};
export function significantWords(key: string): Set<string> {
  return new Set(
    key
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => SYNONYMS[w] ?? w),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** At or above this overlap two headlines are treated as the same story. */
export const SIMILAR = 0.6;

/** The id of the most similar recent item when it is the same story, else null. Needs >= 4 significant words. */
export function findSimilar(
  key: string,
  recent: { id: string; words: Set<string> }[],
  threshold = SIMILAR,
): string | null {
  const words = significantWords(key);
  if (words.size < 4) return null;
  let best: { id: string; score: number } | null = null;
  for (const r of recent) {
    const score = similarity(words, r.words);
    if (score >= threshold && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id ?? null;
}

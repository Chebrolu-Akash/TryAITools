// Mirrors the slug algorithm in src/lib/tool-pages.ts. A parity test
// (src/test/db-import.test.ts) fails if the two ever diverge.
export const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const shortCategory = (categorySlug) => categorySlug.replace(/^ai-/, "").replace(/-tools$/, "");

/** Returns one slug per tool, in input order. */
export function assignSlugs(tools, categories) {
  const catSlug = new Map(categories.map((c) => [c.name, c.slug]));
  const used = new Set();
  return tools.map((tool) => {
    const base = slugify(tool.name) || "tool";
    const suffix = shortCategory(catSlug.get(tool.category) ?? "");
    let slug = base;
    if (used.has(slug)) slug = `${base}-${suffix}`.replace(/-$/, "");
    for (let n = 2; used.has(slug); n++) slug = `${base}-${suffix}-${n}`.replace(/--+/g, "-");
    used.add(slug);
    return slug;
  });
}

/** Stable import key = original JSON id; the 2nd, 3rd... repeat of an id gets "#2", "#3". */
export function assignImportKeys(tools) {
  const seen = new Map();
  return tools.map((t) => {
    const n = (seen.get(t.id) ?? 0) + 1;
    seen.set(t.id, n);
    return n === 1 ? t.id : `${t.id}#${n}`;
  });
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Same rule the public site uses to decide whether a row is suggestable; reported, never deleted. */
export function importIssue(tool) {
  if (/^tool name$/i.test(tool.name.trim())) return "placeholder_name";
  if (!tool.url || !tool.url.trim()) return "missing_url";
  if (!domainOf(tool.url).includes(".")) return "invalid_url";
  return null;
}

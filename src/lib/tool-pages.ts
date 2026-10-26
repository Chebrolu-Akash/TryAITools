import { curatedKey, hasCuratedContent } from "@/lib/tool-content";
import { categories, domainOf, tools, type Tool } from "@/lib/tools";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const shortCategory = (categorySlug: string) => categorySlug.replace(/^ai-/, "").replace(/-tools$/, "");

const categorySlugByName = new Map(categories.map((c) => [c.name, c.slug]));

// Stable, unique URL slug per tool. The first tool with a given name gets the plain name
// (e.g. /tools/chatgpt); later duplicates in other categories get the category appended.
const slugById = new Map<Tool, string>();
const toolBySlug = new Map<string, Tool>();

for (const tool of tools) {
  const base = slugify(tool.name) || "tool";
  let slug = base;
  if (toolBySlug.has(slug)) slug = `${base}-${shortCategory(categorySlugByName.get(tool.category) ?? "")}`.replace(/-$/, "");
  for (let n = 2; toolBySlug.has(slug); n++) slug = `${base}-${shortCategory(categorySlugByName.get(tool.category) ?? "")}-${n}`.replace(/--+/g, "-");
  slugById.set(tool, slug);
  toolBySlug.set(slug, tool);
}

const hash = (s: string) => Array.from(s).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export const slugOfTool = (tool: Tool) => slugById.get(tool) ?? "";
export const toolBySlugName = (slug: string) => toolBySlug.get(slug);
export const allToolSlugs = () => Array.from(toolBySlug.keys());

/** Rows with a placeholder name or no real website (e.g. "Tool Name" / https://Website) are never suggested. */
export const isSuggestable = (tool: Tool) => domainOf(tool.url).includes(".") && !/^tool name$/i.test(tool.name.trim());

/** Other tools in the same subcategory (then category), skipping the same product/domain. */
export function alternativesFor(tool: Tool, limit = 6): Tool[] {
  const self = domainOf(tool.url);
  const seen = new Set<string>([self || tool.name.toLowerCase()]);
  const pick = (list: Tool[], out: Tool[]) => {
    for (const t of list) {
      const key = domainOf(t.url) || t.name.toLowerCase();
      if (t === tool || seen.has(key) || !isSuggestable(t)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= limit) break;
    }
  };
  const out: Tool[] = [];
  pick(tools.filter((t) => t.subcategory === tool.subcategory), out);
  if (out.length < limit) pick(tools.filter((t) => t.category === tool.category), out);
  return out;
}

/** Tools from the same category but a different subcategory, skipping anything already shown. */
export function relatedFor(tool: Tool, exclude: Tool[], limit = 4): Tool[] {
  const seen = new Set<string>([domainOf(tool.url) || tool.name.toLowerCase(), ...exclude.map((t) => domainOf(t.url) || t.name.toLowerCase())]);
  const out: Tool[] = [];
  const pool = tools.filter((t) => t.category === tool.category && t.subcategory !== tool.subcategory);
  // Rotate the starting point per tool so related lists differ between pages.
  const start = pool.length ? hash(slugOfTool(tool)) % pool.length : 0;
  for (const t of [...pool.slice(start), ...pool.slice(0, start)]) {
    const key = domainOf(t.url) || t.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** Sibling subcategories in the tool's category (excluding its own). */
export const siblingSubcategories = (tool: Tool, limit = 6): string[] =>
  (categories.find((c) => c.name === tool.category)?.subcategories ?? []).filter((s) => s !== tool.subcategory).slice(0, limit);

// The first tool listed under each hand-written entry is the "primary" page. Other listings of the
// same product (other categories, "ChatGPT (OpenAI)" etc.) stay reachable but are not indexed.
const primaryByKey = new Map<string, Tool>();
for (const tool of tools) {
  if (!hasCuratedContent(tool)) continue;
  const key = curatedKey(tool);
  if (!primaryByKey.has(key)) primaryByKey.set(key, tool);
}

/** Only pages with tool-specific content, and only one page per product, are indexed and listed in the sitemap. */
export const isIndexable = (tool: Tool) => hasCuratedContent(tool) && primaryByKey.get(curatedKey(tool)) === tool;
export const indexableToolSlugs = () => allToolSlugs().filter((slug) => isIndexable(toolBySlug.get(slug)!));

/** Popular, hand-reviewed tools in the same category that aren't already shown as alternatives. */
export function relatedTools(tool: Tool, exclude: Tool[], limit = 4): Tool[] {
  const skip = new Set<Tool>([tool, ...exclude]);
  const out: Tool[] = [];
  for (const t of primaryByKey.values()) {
    if (t.category !== tool.category || skip.has(t) || !isSuggestable(t)) continue;
    if (domainOf(t.url) && domainOf(t.url) === domainOf(tool.url)) continue;
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** Other categories to suggest, taken from neighbours in the category list. */
export function relatedCategories(categoryName: string, limit = 4) {
  const i = categories.findIndex((c) => c.name === categoryName);
  if (i < 0) return [];
  const out: typeof categories = [];
  for (let step = 1; out.length < limit && step < categories.length; step++) {
    const c = categories[(i + step) % categories.length];
    if (c && c.name !== categoryName) out.push(c);
  }
  return out;
}

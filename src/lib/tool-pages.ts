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

export const slugOfTool = (tool: Tool) => slugById.get(tool) ?? "";
export const toolBySlugName = (slug: string) => toolBySlug.get(slug);
export const allToolSlugs = () => Array.from(toolBySlug.keys());

/** Other tools in the same subcategory (then category), skipping the same product/domain. */
export function alternativesFor(tool: Tool, limit = 6): Tool[] {
  const self = domainOf(tool.url);
  const seen = new Set<string>([self || tool.name.toLowerCase()]);
  const pick = (list: Tool[], out: Tool[]) => {
    for (const t of list) {
      const key = domainOf(t.url) || t.name.toLowerCase();
      if (t === tool || seen.has(key)) continue;
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

import data from "@/data/tools.json";

// The bundled dataset. Public pages read the catalogue through src/lib/catalog (D1 when bound, this file as fallback);
// import this module only from server code and tests, never from components, or the whole dataset ships to browsers.
export { domainOf, logoOf, shortName } from "@/lib/tool-utils";

export type Tool = { id: string; name: string; url: string; category: string; subcategory: string };
export type Category = { name: string; slug: string; subcategories: string[] };

export const tools = data.tools as Tool[];
export const categories = data.categories as Category[];

export const categoryBySlug = (slug: string) => categories.find((c) => c.slug === slug);
export const slugOf = (name: string) => categories.find((c) => c.name === name)?.slug ?? "";
export const toolsIn = (name: string) => tools.filter((t) => t.category === name);

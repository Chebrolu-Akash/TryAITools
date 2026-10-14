import data from "@/data/tools.json";

export type Tool = { id: string; name: string; url: string; category: string; subcategory: string };
export type Category = { name: string; slug: string; subcategories: string[] };

export const tools = data.tools as Tool[];
export const categories = data.categories as Category[];

export const categoryBySlug = (slug: string) => categories.find((c) => c.slug === slug);
export const slugOf = (name: string) => categories.find((c) => c.name === name)?.slug ?? "";
export const toolsIn = (name: string) => tools.filter((t) => t.category === name);

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
export const logoOf = (url: string) => {
  const d = domainOf(url);
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=64` : "";
};
export const shortName = (c: string) => c.replace(/^AI /, "").replace(/ Tools$/, "");

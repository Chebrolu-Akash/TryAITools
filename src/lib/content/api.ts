// Server functions for the content section pages (AI Courses, AI Gadgets, Guest Articles, Blog). They return only the
// public fields chosen in reader.ts; an unknown, draft or archived entry is a 404.
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getD1 } from "@/lib/db/env";
import { isContentSection, type ContentSection } from "./model";
import { createContentReader } from "./reader";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sectionInput = (v: unknown): ContentSection => {
  if (typeof v !== "string" || !isContentSection(v)) throw notFound();
  return v;
};
const itemInput = (v: unknown): { section: ContentSection; slug: string } => {
  const o = (v && typeof v === "object" ? v : {}) as { section?: unknown; slug?: unknown };
  if (typeof o.slug !== "string" || o.slug.length > 120 || !SLUG.test(o.slug)) throw notFound();
  return { section: sectionInput(o.section), slug: o.slug };
};
const reader = async () => createContentReader((await getD1()).db);

export const fetchContentList = createServerFn({ method: "GET" })
  .validator(sectionInput)
  .handler(async ({ data: section }) => ({ items: await (await reader()).list(section) }));

export const fetchContentItem = createServerFn({ method: "GET" })
  .validator(itemInput)
  .handler(async ({ data }) => {
    const r = await reader();
    const item = await r.item(data.section, data.slug);
    if (!item) throw notFound();
    const kind =
      data.section === "courses" ? (item as { kind: "course" | "book" }).kind : undefined;
    const related = await r.related(data.section, data.slug, kind ? { kind } : {});
    return { item, related };
  });

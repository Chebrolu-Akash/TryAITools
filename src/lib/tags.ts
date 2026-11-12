// Functional tags: a fixed vocabulary stored by label in tools.tags (JSON array). Only these labels are shown or
// filterable on the public site, so a stray tag typed in the admin never becomes a public filter.
// No runtime imports: the static gate and the pre-render import this file directly.

export const TOOL_TAGS = [
  "AI Writing",
  "AI Chatbot",
  "Image Generation",
  "Image Editing",
  "Video Generation",
  "Video Editing",
  "Avatars",
  "Voice Generation",
  "Transcription",
  "Translation",
  "Music & Audio",
  "Summarization",
  "AI Coding",
  "No-Code",
  "Design",
  "Presentation",
  "Documents",
  "Email",
  "Meetings",
  "Productivity",
  "Automation",
  "Research",
  "Data Analysis",
  "SEO",
  "Marketing",
  "Social Media",
  "Sales & CRM",
  "Customer Support",
  "E-commerce",
  "Education",
  "HR & Recruiting",
] as const;
export type ToolTag = (typeof TOOL_TAGS)[number];

const BY_LABEL = new Set<string>(TOOL_TAGS);
/** URL value for a tag: "Sales & CRM" -> "sales-crm". */
export const tagSlug = (t: string) =>
  t
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const BY_SLUG = new Map<string, ToolTag>(TOOL_TAGS.map((t) => [tagSlug(t), t]));

/** The tag for a URL value, or null. */
export const tagFromSlug = (v: unknown): ToolTag | null =>
  typeof v === "string" ? (BY_SLUG.get(v) ?? null) : null;

/** Known tags from a stored value (JSON text or array), in vocabulary order; anything else is dropped. */
export function tagsOf(v: unknown): ToolTag[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const have = new Set(list.filter((x): x is string => typeof x === "string" && BY_LABEL.has(x)));
  return TOOL_TAGS.filter((t) => have.has(t));
}

export const matchesTag = (tags: readonly string[] | undefined, tag: ToolTag | null) =>
  !tag || (tags ?? []).includes(tag);

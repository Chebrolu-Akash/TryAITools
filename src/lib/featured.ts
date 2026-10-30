import { logoOf } from "@/lib/tool-utils";
import type { PublicTool } from "@/lib/catalog/model";

// Tool names (exactly as they appear in the catalogue) shown in the hero logo loop. A name that is not currently public
// (unpublished, archived, renamed) is simply skipped. `logoUrl` overrides the domain used for the logo when a tool's
// listed URL has no good favicon.
const ROW_ONE = [
  "ChatGPT (OpenAI)",
  "Claude (Anthropic)",
  "Gemini",
  "Midjourney",
  "Perplexity AI",
  "Cursor AI",
  "ElevenLabs",
  "Notion AI",
  "Canva",
  "Grammarly",
  "Jasper AI",
  "Runway ML",
  "Poe (Quora)",
];
const ROW_TWO = [
  "Figma",
  "Adobe Firefly",
  "Synthesia",
  "HeyGen",
  "Suno AI",
  "Leonardo AI",
  "Descript",
  "Murf AI",
  "Gamma",
  "Zapier",
  "Otter.ai",
  "Copy.ai",
  "Pika Labs",
  "Kling AI",
];
const LOGO_URL: Record<string, string> = {
  "ChatGPT (OpenAI)": "https://chatgpt.com",
  "Cursor AI": "https://cursor.com",
  "Notion AI": "https://www.notion.so",
  "Adobe Firefly": "https://www.adobe.com",
};

/** Every featured name, so the D1 reader can fetch just these rows. */
export const FEATURED_NAMES: readonly string[] = [...ROW_ONE, ...ROW_TWO];

export type FeaturedTool = { name: string; label: string; logo: string; slug: string };

/** One interleaved list (row one, row two, row one, ...) of the featured tools that are currently public. */
export function featuredFrom(tools: readonly PublicTool[]): FeaturedTool[] {
  const byName = new Map<string, PublicTool>();
  for (const t of tools) if (!byName.has(t.name)) byName.set(t.name, t);
  const build = (names: string[]) =>
    names
      .map((n) => byName.get(n))
      .filter((t): t is PublicTool => Boolean(t))
      .map((t) => ({
        name: t.name,
        label: t.name.replace(/ \(.+\)$/, ""),
        logo: logoOf(LOGO_URL[t.name] ?? t.url, 128),
        slug: t.slug,
      }));
  const one = build(ROW_ONE);
  const two = build(ROW_TWO);
  return Array.from({ length: Math.max(one.length, two.length) }, (_, i) => [one[i], two[i]])
    .flat()
    .filter((t): t is FeaturedTool => Boolean(t));
}

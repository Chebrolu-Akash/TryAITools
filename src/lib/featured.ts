import { slugOfTool } from "@/lib/tool-pages";
import { logoOf, tools, type Tool } from "@/lib/tools";

// Tool names (exactly as they appear in tools.json) shown in the hero logo loops.
// `logoUrl` overrides the domain used to fetch the logo when a tool's listed URL has no good favicon.
const ROW_ONE = [
  "ChatGPT (OpenAI)", "Claude (Anthropic)", "Gemini", "Midjourney", "Perplexity AI", "Cursor AI",
  "ElevenLabs", "Notion AI", "Canva", "Grammarly", "Jasper AI", "Runway ML", "Poe (Quora)",
];
const ROW_TWO = [
  "Figma", "Adobe Firefly", "Synthesia", "HeyGen", "Suno AI", "Leonardo AI", "Descript",
  "Murf AI", "Gamma", "Zapier", "Otter.ai", "Copy.ai", "Pika Labs", "Kling AI",
];
const LOGO_URL: Record<string, string> = {
  "ChatGPT (OpenAI)": "https://chatgpt.com",
  "Cursor AI": "https://cursor.com",
  "Notion AI": "https://www.notion.so",
  "Adobe Firefly": "https://www.adobe.com",
};

export type FeaturedTool = { name: string; label: string; logo: string; slug: string };

const build = (names: string[]): FeaturedTool[] =>
  names
    .map((n) => tools.find((t: Tool) => t.name === n))
    .filter((t): t is Tool => Boolean(t))
    .map((t) => ({
      name: t.name,
      label: t.name.replace(/ \(.+\)$/, ""),
      logo: logoOf(LOGO_URL[t.name] ?? t.url, 128),
      slug: slugOfTool(t),
    }));

export const featuredRowOne = build(ROW_ONE);
export const featuredRowTwo = build(ROW_TWO);

// One interleaved list for the single-row hero loop.
export const featuredAll: FeaturedTool[] = Array.from(
  { length: Math.max(featuredRowOne.length, featuredRowTwo.length) },
  (_, i) => [featuredRowOne[i], featuredRowTwo[i]],
)
  .flat()
  .filter((t): t is FeaturedTool => Boolean(t));

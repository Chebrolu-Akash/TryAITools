// Regression: category names containing "&" must use their own template, not the Chatbots fallback.
import { describe, expect, it } from "vitest";
import { catSlug, contentFor } from "@/lib/tool-content";
import { categories } from "@/lib/tools";

const CHATBOT_AUDIENCE = "Almost anyone: students, professionals, developers and teams.";
const tool = (category: string, name = "Example Tool") => ({
  id: "example-tool",
  name,
  url: "https://example.com",
  category,
  subcategory: "Example Subcategory",
});

const AMPERSAND_CASES: [name: string, id: string, audience: string, step0: string][] = [
  ["AI Audio & Voice Tools", "ai-audio-voice-tools", "Podcasters, video creators, educators and teams that work with audio.", "Open Example Tool and create a new audio project."],
  ["AI Coding & Developer Tools", "ai-coding-developer-tools", "Developers, students and technical teams.", ""],
  ["AI Design & UI/UX Tools", "ai-design-ui-ux-tools", "Designers, product teams and founders.", ""],
  ["AI Education & Learning Tools", "ai-education-learning-tools", "Students, teachers and lifelong learners.", ""],
  ["AI Resume & HR Tools", "ai-resume-hr-tools", "Job seekers, recruiters and HR teams.", ""],
];

describe("category template matching", () => {
  it.each(AMPERSAND_CASES)("%s maps to %s and its own template", (name, id, audience, step0) => {
    expect(catSlug(name)).toBe(id);
    const c = contentFor(tool(name));
    expect(c.bestFor).toBe(audience);
    expect(c.bestFor).not.toBe(CHATBOT_AUDIENCE);
    expect(c.overview).not.toContain("through conversation");
    expect(c.steps.join(" ")).not.toContain("start a new conversation");
    if (step0) expect(c.steps[0]).toBe(step0);
  });

  it("every catalogue category name maps to its category ID", () => {
    for (const c of categories) expect(catSlug(c.name), c.name).toBe(c.slug);
  });

  it("only the Chatbots category uses the Chatbots template", () => {
    for (const c of categories) {
      const bestFor = contentFor(tool(c.name)).bestFor;
      if (c.slug === "ai-chatbots-assistants") expect(bestFor).toBe(CHATBOT_AUDIENCE);
      else expect(bestFor, c.name).not.toBe(CHATBOT_AUDIENCE);
    }
  });

  it("curated tools in an & category get that category's guidance", () => {
    const c = contentFor(tool("AI Audio & Voice Tools", "ElevenLabs"));
    expect(c.curated).toBe(true);
    expect(c.bestFor).toBe("Podcasters, video creators, educators and teams that work with audio.");
  });
});

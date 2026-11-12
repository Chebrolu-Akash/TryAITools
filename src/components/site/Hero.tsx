import { useState, type FormEvent } from "react";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import { HeroBackground } from "@/components/site/HeroBackground";
import { ToolLogoLoops } from "@/components/site/ToolLogoLoops";
import type { FeaturedTool } from "@/lib/featured";
import { useSiteSummary } from "@/lib/catalog/use-site";

const popular = ["ChatGPT", "Midjourney", "Cursor", "ElevenLabs", "Notion AI"];

export function Hero({ featured }: { featured: FeaturedTool[] }) {
  const { toolCount } = useSiteSummary();
  const [q, setQ] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    // Full page load: /tools is a pre-built page that runs the search itself.
    window.location.assign(s ? `/tools?${new URLSearchParams({ q: s })}` : "/tools");
  };

  return (
    <section className="relative flex min-h-svh flex-col justify-center overflow-hidden rounded-b-[2.5rem] bg-hero-flow sm:rounded-b-[3.5rem]">
      <HeroBackground />
      <div className="relative mx-auto max-w-4xl pb-0 pt-28 text-center sm:pt-28 page-x">
        <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/80 px-4 py-1.5 text-xs font-semibold text-primary shadow-[0_1px_2px_rgb(15_23_42/0.05)] sm:text-sm">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0" />
          Updated daily · Free to browse · No sign-up
        </p>
        <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
          Find the right AI tool
          <span className="block text-primary">for every task</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Search {toolCount.toLocaleString()} hand-picked tools for writing, images, video, code and
          everything in between — then browse them by category.
        </p>

        <form
          onSubmit={submit}
          className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full bg-background p-2 shadow-soft ring-1 ring-primary/15"
        >
          <Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or use case…"
            aria-label="Search AI tools"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none sm:text-base"
          />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Search <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground/70">Popular:</span>
          {popular.map((name) => (
            <a
              key={name}
              href={`/tools?${new URLSearchParams({ q: name })}`}
              className="rounded-full border border-primary/15 bg-background/70 px-3 py-1 text-xs font-medium transition-colors hover:border-primary/45 hover:text-primary"
            >
              {name}
            </a>
          ))}
        </p>
      </div>
      <div className="relative pb-12 sm:pb-14">
        <ToolLogoLoops featured={featured} />
      </div>
    </section>
  );
}

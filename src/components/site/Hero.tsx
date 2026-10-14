import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { HeroBackground } from "@/components/site/HeroBackground";
import { ToolLogoLoops } from "@/components/site/ToolLogoLoops";
import { categories, tools } from "@/lib/tools";

const popular = ["ChatGPT", "Midjourney", "Cursor", "ElevenLabs", "Notion AI"];

export function Hero() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    void navigate({ to: "/tools", search: s ? { q: s } : {} });
  };

  return (
    <section className="relative mx-3 flex min-h-[calc(100svh-5.5rem)] flex-col justify-center overflow-hidden rounded-b-[2.5rem] bg-hero-flow sm:mx-6 sm:rounded-b-[3.5rem]">
      <HeroBackground />
      <div className="relative mx-auto max-w-4xl px-4 pb-0 pt-10 text-center sm:px-6 sm:pt-12">
        <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-4 py-1.5 text-xs font-semibold text-primary">
          {tools.length.toLocaleString()} tools · {categories.length} categories · updated weekly
        </p>
        <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
          Find the right AI tool
          <span className="block text-primary">for every task</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Search {tools.length.toLocaleString()} hand-picked tools for writing, images, video, code and everything in between — then browse them by category.
        </p>

        <form onSubmit={submit} className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full bg-background p-2 shadow-soft ring-1 ring-primary/15">
          <Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or use case…"
            aria-label="Search AI tools"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none sm:text-base"
          />
          <button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
            Search <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground/70">Popular:</span>
          {popular.map((name) => (
            <Link key={name} to="/tools" search={{ q: name }} className="rounded-full border border-primary/15 bg-background/70 px-3 py-1 text-xs font-medium transition-colors hover:border-primary/45 hover:text-primary">
              {name}
            </Link>
          ))}
        </p>
      </div>
      <div className="relative pb-12 sm:pb-14">
        <ToolLogoLoops />
      </div>
    </section>
  );
}

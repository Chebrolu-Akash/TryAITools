import { createFileRoute } from "@tanstack/react-router";
import { Bot, BrainCircuit, Cpu, MessageSquare, Sparkles, Workflow } from "lucide-react";
import { Page } from "@/components/site/Layout";
import { pageHead } from "@/lib/seo";

// Coming soon: no agent listings exist yet, so the page is noindex and not in the sitemap. It claims nothing beyond that.
export const Route = createFileRoute("/agents")({
  head: () =>
    pageHead({
      title: "AI Agents (coming soon) | TryAITools",
      description:
        "A smarter way to discover AI agents that can work for you is on its way to TryAITools.",
      path: "/agents",
      noindex: true,
    }),
  component: AgentsPage,
});

const FLOATERS = [
  { Icon: Bot, className: "left-[8%] top-[22%] [animation-delay:-1s]" },
  { Icon: Workflow, className: "right-[10%] top-[18%] [animation-delay:-3s]" },
  { Icon: BrainCircuit, className: "left-[14%] bottom-[18%] [animation-delay:-5s]" },
  { Icon: MessageSquare, className: "right-[16%] bottom-[22%] [animation-delay:-2s]" },
  { Icon: Cpu, className: "left-[47%] top-[8%] [animation-delay:-4s]" },
];

function AgentsPage() {
  return (
    <Page>
      <section className="agents-hero relative isolate overflow-hidden">
        <div aria-hidden className="agents-glow" />
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
          {FLOATERS.map(({ Icon, className }, i) => (
            <span key={i} className={`agents-float ${className}`}>
              <Icon className="h-6 w-6" strokeWidth={1.75} />
            </span>
          ))}
        </div>
        <div className="page-container relative flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-background/80 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary shadow-soft backdrop-blur">
            <span className="agents-pulse" aria-hidden />
            Coming Soon
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Meet Your Next <span className="agents-gradient-text">AI Agent</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-foreground/75 sm:text-lg">
            We&apos;re building a smarter way to discover AI agents that can work for you. Stay
            tuned.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
            >
              <Sparkles aria-hidden className="h-4 w-4" /> Browse AI Tools
            </a>
            <a
              href="/learn"
              className="inline-flex items-center rounded-full border border-primary/25 bg-background px-6 py-3 text-sm font-bold text-primary transition hover:border-primary/50"
            >
              Visit the AI Learning Hub
            </a>
          </div>
        </div>
      </section>
    </Page>
  );
}

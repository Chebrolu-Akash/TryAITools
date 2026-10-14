import { Link } from "@tanstack/react-router";
import {
  ArrowRight, AudioLines, Bot, Briefcase, Code, FileText, GraduationCap, Image as ImageIcon, Megaphone,
  Palette, PenLine, Search, Share2, ShoppingCart, Sparkles, Users, Video, type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { categories, logoOf, shortName, tools, toolsIn, type Tool } from "@/lib/tools";

const ICONS: Record<string, LucideIcon> = {
  "ai-writing-tools": PenLine,
  "ai-image-tools": ImageIcon,
  "ai-video-tools": Video,
  "ai-audio-voice-tools": AudioLines,
  "ai-chatbots-assistants": Bot,
  "ai-marketing-tools": Megaphone,
  "ai-seo-tools": Search,
  "ai-coding-developer-tools": Code,
  "ai-design-ui-ux-tools": Palette,
  "ai-social-media-tools": Share2,
  "ai-business-tools": Briefcase,
  "ai-office-tools": FileText,
  "ai-resume-hr-tools": Users,
  "ai-education-learning-tools": GraduationCap,
  "ai-e-commerce-tools": ShoppingCart,
};

function ToolLogo({ tool }: { tool: Tool }) {
  const [failed, setFailed] = useState(false);
  const logo = logoOf(tool.url, 64);
  return (
    <span title={tool.name} className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white text-xs font-bold text-primary shadow-sm ring-2 ring-white outline outline-1 outline-primary/15">
      {logo && !failed ? (
        <img src={logo} alt={tool.name} width={22} height={22} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-[22px] w-[22px] object-contain" onError={() => setFailed(true)} />
      ) : (
        tool.name.slice(0, 1)
      )}
    </span>
  );
}

export function CategoryBrowser({ heading = "h1" }: { heading?: "h1" | "h2" }) {
  const Heading = heading;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {categories.length} categories · {tools.length.toLocaleString()} tools
        </span>
        <Heading className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Browse all <span className="text-primary">AI tools</span>
        </Heading>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">Hand-picked and organized by what you want to get done.</p>
        <nav aria-label="Jump to category" className="mt-7 flex flex-wrap gap-2.5">
          {categories.map((category) => (
            <a
              key={category.slug}
              href={`#${category.slug}`}
              className="rounded-full border border-primary/15 bg-background px-4 py-2 text-sm font-semibold text-foreground/85 shadow-card transition-colors hover:border-transparent hover:bg-gradient-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {shortName(category.name)}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-12 space-y-8 sm:mt-14">
        {categories.map((category, index) => {
          const categoryTools = toolsIn(category.name);
          const Icon = ICONS[category.slug] ?? Sparkles;
          return (
            <section
              key={category.slug}
              id={category.slug}
              className={`scroll-mt-28 rounded-[2rem] border border-primary/10 p-5 sm:rounded-[2.25rem] sm:p-8 ${index % 2 === 0 ? "bg-gradient-to-b from-lavender/70 to-background" : "bg-gradient-to-b from-background to-lavender/70"}`}
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-soft sm:h-14 sm:w-14">
                    <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
                  </span>
                  <div>
                    <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{category.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{category.subcategories.length} subcategories · {categoryTools.length} tools</p>
                  </div>
                </div>
                <Link
                  to="/categories/$slug"
                  params={{ slug: category.slug }}
                  search={{ sub: undefined }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-background px-5 py-2.5 text-sm font-bold text-primary shadow-soft transition hover:bg-primary hover:text-primary-foreground"
                >
                  View more <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.subcategories.slice(0, 6).map((subcategory) => {
                  const list = categoryTools.filter((tool) => tool.subcategory === subcategory);
                  const extra = list.length - 3;
                  return (
                    <Link
                      key={subcategory}
                      to="/categories/$slug"
                      params={{ slug: category.slug }}
                      search={{ sub: subcategory }}
                      className="group relative flex min-h-44 flex-col rounded-3xl border border-primary/10 bg-card p-5 shadow-[0_14px_30px_-22px_color-mix(in_oklab,var(--primary)_55%,transparent)] transition duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_24px_40px_-22px_color-mix(in_oklab,var(--primary)_70%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <h3 className="pr-20 text-base font-bold leading-snug group-hover:text-primary">{subcategory}</h3>
                      <span className="absolute right-4 top-4 rounded-full bg-accent px-3 py-1 text-xs font-bold text-primary">{list.length} tools</span>
                      <div className="mt-auto flex items-center justify-between pt-8">
                        <div className="flex items-center -space-x-2.5">
                          {list.slice(0, 3).map((tool) => <ToolLogo key={tool.id} tool={tool} />)}
                          {extra > 0 && (
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-[11px] font-bold text-primary ring-2 ring-white">+{extra}</span>
                          )}
                        </div>
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
              {category.subcategories.length > 6 && (
                <Link
                  to="/categories/$slug"
                  params={{ slug: category.slug }}
                  search={{ sub: undefined }}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
                >
                  View all {category.subcategories.length} subcategories <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </section>
          );
        })}
      </div>

      <section className="relative mt-14 overflow-hidden rounded-[2rem] bg-gradient-to-b from-[#8a86ff] to-[#5f5bf5] px-6 py-14 text-center text-white sm:rounded-[2.75rem] sm:py-16">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-20 h-[26rem] w-72 rounded-full bg-white/15" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-20 h-[26rem] w-72 rounded-full bg-white/15" />
        <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Can&apos;t find the right tool?</h2>
        <p className="relative mt-3 text-base text-white/90 sm:text-lg">Search all {tools.length.toLocaleString()} AI tools by name, task or use case.</p>
        <div className="relative mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/tools" className="rounded-full bg-white px-7 py-3 text-sm font-bold text-primary shadow-soft transition hover:opacity-90 sm:text-base">Search all tools</Link>
          <a href={`#${categories[0]?.slug ?? ""}`} className="rounded-full border border-white/70 px-7 py-3 text-sm font-bold text-white transition hover:bg-white/10 sm:text-base">Browse categories</a>
        </div>
      </section>
    </div>
  );
}

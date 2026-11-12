import { ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { CategoryIcon, categoryIconFor } from "@/components/site/CategoryIcon";
import type { BrowseCategory } from "@/lib/catalog/views";
import { dropAI, logoOf, shortName } from "@/lib/tool-utils";

type PreviewTool = { name: string; url: string };

function ToolLogo({ tool }: { tool: PreviewTool }) {
  const [failed, setFailed] = useState(false);
  const logo = logoOf(tool.url, 64);
  return (
    <span title={tool.name} className="sub-card-dot">
      {logo && !failed ? (
        <img
          src={logo}
          alt={tool.name}
          width={22}
          height={22}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-[22px] w-[22px] object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        tool.name.slice(0, 1)
      )}
    </span>
  );
}

export function CategoryBrowser({
  heading = "h1",
  toolCount,
  categories,
}: {
  heading?: "h1" | "h2";
  toolCount: number;
  categories: BrowseCategory[];
}) {
  const Heading = heading;
  return (
    <div className="page-container pt-16 sm:pt-24">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {categories.length} categories ·{" "}
          {toolCount.toLocaleString()} tools
        </span>
        <Heading className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Browse all <span className="text-primary">AI tools</span>
        </Heading>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
          Hand-picked and organized by what you want to get done.
        </p>
        <nav aria-label="Jump to category" className="mt-7 flex flex-wrap gap-2.5">
          {categories.map((category) => (
            <a
              key={category.slug}
              href={`#${category.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-background px-4 py-2 text-sm font-semibold text-foreground/85 shadow-card transition-colors hover:border-transparent hover:bg-gradient-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CategoryIcon slug={category.slug} className="h-3.5 w-3.5" />
              {shortName(category.name)}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-12 space-y-8 sm:mt-14">
        {categories.map((category, index) => {
          const Icon = categoryIconFor(category.slug);
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
                    <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                      {category.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                      {category.subcategories.length} subcategories · {category.toolCount} tools
                    </p>
                  </div>
                </div>
                <a
                  href={`/categories/${category.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-background px-5 py-2.5 text-sm font-bold text-primary shadow-soft transition hover:bg-primary hover:text-primary-foreground"
                >
                  View more <ArrowRight className="h-4 w-4" />
                </a>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.subcategories.slice(0, 6).map(({ name: subcategory, count, preview }) => {
                  const extra = count - 3;
                  return (
                    <a
                      key={subcategory}
                      href={`/categories/${category.slug}?${new URLSearchParams({ sub: subcategory })}`}
                      className="group sub-card"
                    >
                      <h3 className="pr-20 text-base font-bold leading-snug group-hover:text-primary">
                        {dropAI(subcategory)}
                      </h3>
                      <span className="absolute right-4 top-4 rounded-full bg-accent px-3 py-1 text-xs font-bold text-primary">
                        {count} tools
                      </span>
                      <div className="mt-auto flex items-center justify-between pt-8">
                        <div className="flex items-center -space-x-2.5">
                          {preview.map((tool) => (
                            <ToolLogo key={tool.slug} tool={tool} />
                          ))}
                          {extra > 0 && <span className="sub-card-more">+{extra}</span>}
                        </div>
                        <span className="sub-card-arrow">
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
              {category.subcategories.length > 6 && (
                <a
                  href={`/categories/${category.slug}`}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
                >
                  View all {category.subcategories.length} subcategories{" "}
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </section>
          );
        })}
      </div>

      <section className="relative mt-14 overflow-hidden rounded-[2rem] bg-gradient-to-b from-[#8a86ff] to-[#5f5bf5] px-6 py-14 text-center text-white sm:rounded-[2.75rem] sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-20 h-[26rem] w-72 rounded-full bg-white/15"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-20 h-[26rem] w-72 rounded-full bg-white/15"
        />
        <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">
          Can&apos;t find the right tool?
        </h2>
        <p className="relative mt-3 text-base text-white/90 sm:text-lg">
          Search all {toolCount.toLocaleString()} AI tools by name, task or use case.
        </p>
        <div className="relative mt-7 flex flex-wrap justify-center gap-3">
          <a
            href="/tools"
            className="rounded-full bg-white px-7 py-3 text-sm font-bold text-primary shadow-soft transition hover:opacity-90 sm:text-base"
          >
            Search all tools
          </a>
          <a
            href={`#${categories[0]?.slug ?? ""}`}
            className="rounded-full border border-white/70 px-7 py-3 text-sm font-bold text-white transition hover:bg-white/10 sm:text-base"
          >
            Browse categories
          </a>
        </div>
      </section>
    </div>
  );
}

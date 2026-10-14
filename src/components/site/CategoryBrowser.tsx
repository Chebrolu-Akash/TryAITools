import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { categories, logoOf, shortName, tools, toolsIn, type Tool } from "@/lib/tools";

function ToolLogo({ tool }: { tool: Tool }) {
  const [failed, setFailed] = useState(false);
  const logo = logoOf(tool.url);
  return (
    <span title={tool.name} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-card bg-lavender text-xs font-semibold text-primary">
      {logo && !failed ? <img src={logo} alt={tool.name} loading="lazy" className="h-5 w-5 object-contain" onError={() => setFailed(true)} /> : tool.name.slice(0, 1)}
    </span>
  );
}

export function CategoryBrowser({ heading = "h1" }: { heading?: "h1" | "h2" }) {
  const Heading = heading;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14">
      <header>
        <Heading className="text-4xl font-bold leading-tight sm:text-5xl">Browse all AI tools</Heading>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">{tools.length.toLocaleString()} curated tools across {categories.length} categories.</p>
        <nav aria-label="Jump to category" className="mt-7 flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button key={category.slug} asChild variant="outline" size="sm" className="rounded-full border-primary/15 bg-lavender/40 text-foreground hover:border-primary/40">
              <a href={`#${category.slug}`}>{shortName(category.name)}</a>
            </Button>
          ))}
        </nav>
      </header>
      <div className="mt-12 space-y-14 sm:mt-14 sm:space-y-16">
        {categories.map((category) => {
          const categoryTools = toolsIn(category.name);
          return (
            <section key={category.slug} id={category.slug} className="scroll-mt-24">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold sm:text-3xl">{category.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{category.subcategories.length} subcategories · {categoryTools.length} tools</p>
                </div>
                <Button asChild variant="outline" size="sm" className="rounded-full border-primary/20 text-primary">
                  <Link to="/categories/$slug" params={{ slug: category.slug }} search={{ sub: undefined }}>View more <ArrowRight /></Link>
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.subcategories.slice(0, 6).map((subcategory) => {
                  const list = categoryTools.filter((tool) => tool.subcategory === subcategory);
                  return (
                    <Link key={subcategory} to="/categories/$slug" params={{ slug: category.slug }} search={{ sub: subcategory }} className="group flex min-h-40 flex-col rounded-lg border border-primary/15 bg-card p-5 shadow-card transition-colors hover:border-primary/50 hover:bg-lavender/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <h3 className="text-sm font-semibold leading-6 group-hover:text-primary">{subcategory}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{list.length} tools</p>
                      <div className="mt-auto flex items-center justify-between pt-9">
                        <div className="flex -space-x-2">{list.slice(0, 4).map((tool) => <ToolLogo key={tool.id} tool={tool} />)}</div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                      </div>
                    </Link>
                  );
                })}
              </div>
              <Button asChild variant="link" className="mt-3 h-auto px-0 py-2 text-xs text-muted-foreground hover:text-primary">
                <Link to="/categories/$slug" params={{ slug: category.slug }} search={{ sub: undefined }}>View all {category.subcategories.length} subcategories <ArrowRight /></Link>
              </Button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
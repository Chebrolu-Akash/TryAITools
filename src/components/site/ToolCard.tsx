import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { domainOf, logoOf, shortName, slugOf, type Tool } from "@/lib/tools";

export function ToolCard({ tool, showCategory = true }: { tool: Tool; showCategory?: boolean }) {
  const [err, setErr] = useState(false);
  const logo = logoOf(tool.url);
  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-lavender font-display font-bold text-primary">
          {logo && !err ? (
            <img src={logo} alt="" loading="lazy" className="h-7 w-7" onError={() => setErr(true)} />
          ) : (
            tool.name[0]
          )}
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{tool.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{domainOf(tool.url)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {showCategory && (
          <Link
            to="/categories/$slug"
            params={{ slug: slugOf(tool.category) }}
            className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
          >
            {shortName(tool.category)}
          </Link>
        )}
        {tool.subcategory && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{tool.subcategory.replace(/^AI /, "")}</span>
        )}
      </div>
      {tool.url && (
        <a
          href={tool.url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="mt-5 inline-flex items-center justify-center gap-1 rounded-xl border border-primary/30 py-2 text-sm font-semibold text-primary transition group-hover:bg-primary group-hover:text-primary-foreground"
        >
          Visit Tool <ArrowUpRight className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { slugOfTool } from "@/lib/tool-pages";
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
          <h3 className="truncate font-semibold"><Link to="/tools/$slug" params={{ slug: slugOfTool(tool) }} className="hover:text-primary">{tool.name}</Link></h3>
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
      <div className="mt-5 flex items-center gap-2">
        <Link
          to="/tools/$slug"
          params={{ slug: slugOfTool(tool) }}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-primary/30 py-2 text-sm font-semibold text-primary transition group-hover:bg-primary group-hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View Details
        </Link>
        {tool.url && (
          <a
            href={tool.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            aria-label={`Open ${tool.name} official website in a new tab`}
            title="Official website"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground transition hover:border-primary/40 hover:text-primary"
          >
            <ArrowUpRight className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

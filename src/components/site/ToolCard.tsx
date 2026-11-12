import { useState } from "react";
import { CategoryIcon } from "@/components/site/CategoryIcon";
import type { PublicTool } from "@/lib/catalog/model";
import { PRICING_LABELS } from "@/lib/pricing";
import { tagsOf } from "@/lib/tags";
import { domainOf, dropAI, logoOf, shortName } from "@/lib/tool-utils";

// Plain links (full page loads): public pages are pre-built static HTML, so following a link must request that file, not
// run the client router (which would call the Worker). The card's styles live in src/styles.css (.tool-card*).
export function ToolCard({
  tool,
  showCategory = true,
}: {
  tool: PublicTool;
  showCategory?: boolean;
}) {
  const [err, setErr] = useState(false);
  const logo = logoOf(tool.url);
  const href = `/tools/${tool.slug}`;
  return (
    <div className="group tool-card">
      <div className="flex items-start gap-3">
        <div className="tool-card-logo">
          {logo && !err ? (
            <img
              src={logo}
              alt=""
              width={28}
              height={28}
              loading="lazy"
              decoding="async"
              className="h-7 w-7"
              onError={() => setErr(true)}
            />
          ) : (
            tool.name[0]
          )}
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-semibold">
            <a href={href} className="hover:text-primary">
              {tool.name}
            </a>
          </h3>
          <p className="truncate text-xs text-muted-foreground">{domainOf(tool.url)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {showCategory && (
          <a
            href={`/categories/${tool.categorySlug}`}
            className="tool-card-chip inline-flex items-center gap-1 bg-accent font-medium text-accent-foreground"
          >
            <CategoryIcon slug={tool.categorySlug} className="h-3 w-3" />
            {shortName(tool.category)}
          </a>
        )}
        {tool.subcategory && (
          <span className="tool-card-chip bg-muted text-muted-foreground">
            {dropAI(tool.subcategory)}
          </span>
        )}
        {tool.pricing && (
          <span className="tool-card-price" data-pricing={tool.pricing}>
            {PRICING_LABELS[tool.pricing]}
          </span>
        )}
        {tagsOf(tool.tags)
          .slice(0, 2)
          .map((t) => (
            <span key={t} className="tool-card-chip border border-border text-foreground/70">
              {t}
            </span>
          ))}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-5">
        <a href={href} className="tool-card-cta">
          Explore
        </a>
        {tool.url && (
          <a
            href={tool.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            aria-label={`TryAI: open ${tool.name}'s official website in a new tab`}
            title="Official website"
            className="tool-card-try"
          >
            TryAI
          </a>
        )}
      </div>
    </div>
  );
}

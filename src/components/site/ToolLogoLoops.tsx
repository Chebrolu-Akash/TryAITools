import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LogoLoop, type LogoItem } from "@/components/site/LogoLoop";
import { featuredRowOne, featuredRowTwo, type FeaturedTool } from "@/lib/featured";

function Chip({ tool }: { tool: FeaturedTool }) {
  const [failed, setFailed] = useState(false);
  return (
    <Link
      to="/tools"
      search={{ q: tool.label }}
      title={`Find ${tool.label} and similar tools`}
      className="inline-flex items-center gap-2.5 rounded-full border border-primary/10 bg-background py-1.5 pl-1.5 pr-4 text-sm font-semibold text-foreground/85 shadow-card transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-lavender text-sm font-bold text-primary">
        {failed ? (
          tool.label.slice(0, 1)
        ) : (
          <img src={tool.logo} alt="" width={24} height={24} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-6 w-6 object-contain" onError={() => setFailed(true)} />
        )}
      </span>
      <span className="whitespace-nowrap">{tool.label}</span>
    </Link>
  );
}

const toItems = (list: FeaturedTool[]): (LogoItem & { tool: FeaturedTool })[] =>
  list.map((tool) => ({ node: null, tool }));

const renderChip = (item: LogoItem) => <Chip tool={(item as LogoItem & { tool: FeaturedTool }).tool} />;

const FADE = "color-mix(in oklab, var(--lavender) 45%, white)";

export function ToolLogoLoops() {
  return (
    <div className="mx-auto mt-12 max-w-5xl space-y-4" aria-label="Featured AI tools">
      <LogoLoop logos={toItems(featuredRowOne)} renderItem={renderChip} direction="left" speed={45} gap={16} logoHeight={44} pauseOnHover fadeOut fadeOutColor={FADE} ariaLabel="Featured AI tools, row one" />
      <LogoLoop logos={toItems(featuredRowTwo)} renderItem={renderChip} direction="right" speed={45} gap={16} logoHeight={44} pauseOnHover fadeOut fadeOutColor={FADE} ariaLabel="Featured AI tools, row two" />
    </div>
  );
}

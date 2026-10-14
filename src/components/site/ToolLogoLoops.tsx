import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LogoLoop, type LogoItem } from "@/components/site/LogoLoop";
import { featuredAll, type FeaturedTool } from "@/lib/featured";

function Chip({ tool }: { tool: FeaturedTool }) {
  const [failed, setFailed] = useState(false);
  return (
    <Link
      to="/tools"
      search={{ q: tool.label }}
      title={`Find ${tool.label} and similar tools`}
      className="group inline-flex items-center gap-2.5 rounded-md text-base font-semibold text-foreground/55 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {failed ? (
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{tool.label.slice(0, 1)}</span>
      ) : (
        <img
          src={tool.logo}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-8 w-8 object-contain opacity-70 grayscale transition duration-300 group-hover:opacity-100 group-hover:grayscale-0"
          onError={() => setFailed(true)}
        />
      )}
      <span className="whitespace-nowrap">{tool.label}</span>
    </Link>
  );
}

const items: (LogoItem & { tool: FeaturedTool })[] = featuredAll.map((tool) => ({ node: null, tool }));
const renderChip = (item: LogoItem) => <Chip tool={(item as LogoItem & { tool: FeaturedTool }).tool} />;

const FADE = "color-mix(in oklab, var(--lavender) 45%, white)";

export function ToolLogoLoops() {
  return (
    <div className="mx-auto mt-14 max-w-5xl px-4 sm:px-6">
      <p className="mb-6 text-center text-base font-medium text-foreground/70 sm:text-lg">Explore the AI tools people use every day</p>
      <LogoLoop logos={items} renderItem={renderChip} direction="left" speed={50} gap={56} logoHeight={32} pauseOnHover fadeOut fadeOutColor={FADE} ariaLabel="Featured AI tools" />
    </div>
  );
}

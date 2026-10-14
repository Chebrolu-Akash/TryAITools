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
      draggable={false}
      title={`Find ${tool.label} and similar tools`}
      className="group inline-flex items-center gap-2.5 rounded-md text-base font-bold text-white/95 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {failed ? (
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/95 text-sm font-bold text-primary">{tool.label.slice(0, 1)}</span>
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/95 shadow-sm">
          <img src={tool.logo} alt="" width={24} height={24} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-6 w-6 object-contain" onError={() => setFailed(true)} />
        </span>
      )}
      <span className="whitespace-nowrap">{tool.label}</span>
    </Link>
  );
}

const items: (LogoItem & { tool: FeaturedTool })[] = featuredAll.map((tool) => ({ node: null, tool }));
const renderChip = (item: LogoItem) => <Chip tool={(item as LogoItem & { tool: FeaturedTool }).tool} />;

const EDGE_FADE = { maskImage: "linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)" } as const;

export function ToolLogoLoops() {
  return (
    <div className="mx-auto mt-14 max-w-5xl px-4 sm:px-6">
      <p className="mb-6 text-center text-base font-semibold text-white sm:text-lg">Explore the AI tools people use every day</p>
      <LogoLoop logos={items} renderItem={renderChip} direction="left" speed={50} gap={56} logoHeight={36} pauseOnHover style={EDGE_FADE} ariaLabel="Featured AI tools" />
    </div>
  );
}

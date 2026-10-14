import type { CSSProperties } from "react";
import { Braces, Command, Music, PenLine, Play, Sparkles, type LucideIcon } from "lucide-react";

const TILES: { Icon: LucideIcon; className: string; rot: string; delay: string }[] = [
  { Icon: Sparkles, className: "left-[10%] top-[32%] h-14 w-14", rot: "-8deg", delay: "0s" },
  { Icon: Command, className: "left-[18%] top-[62%] h-14 w-14", rot: "6deg", delay: "-2s" },
  { Icon: PenLine, className: "left-[6%] top-[50%] h-12 w-12", rot: "-3deg", delay: "-4s" },
  { Icon: Play, className: "right-[10%] top-[31%] h-14 w-14", rot: "8deg", delay: "-1s" },
  { Icon: Music, className: "right-[17%] top-[58%] h-14 w-14", rot: "-6deg", delay: "-3s" },
  { Icon: Braces, className: "right-[6%] top-[48%] h-12 w-12", rot: "4deg", delay: "-5s" },
];

/** Decorative hero background: colour glows, fading grid, orbit lines and floating category tiles. */
export function HeroBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-hero-glows" />
      <div className="absolute inset-0 bg-grid-lines [mask-image:radial-gradient(ellipse_70%_60%_at_50%_42%,#000,transparent_75%)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1412 850" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="orbit-stroke" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#5353f1" stopOpacity="0" />
            <stop offset="0.5" stopColor="#5353f1" stopOpacity="0.45" />
            <stop offset="1" stopColor="#8a6bff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#orbit-stroke)" strokeWidth="1.4">
          <ellipse cx="706" cy="470" rx="420" ry="250" />
          <ellipse cx="706" cy="470" rx="620" ry="360" />
          <ellipse cx="706" cy="470" rx="840" ry="480" />
        </g>
        <g fill="#fff" stroke="#5353f1" strokeOpacity="0.35">
          <circle cx="286" cy="470" r="7" />
          <circle cx="1126" cy="470" r="7" />
          <circle cx="210" cy="300" r="5" />
          <circle cx="1250" cy="640" r="6" />
        </g>
      </svg>
      <div className="hidden lg:block">
        {TILES.map(({ Icon, className, rot, delay }, i) => (
          <span
            key={i}
            className={`float-tile absolute grid place-items-center rounded-2xl border border-white/90 bg-white/75 text-primary shadow-[0_18px_36px_-14px_color-mix(in_oklab,var(--primary)_55%,transparent)] backdrop-blur-md ${className}`}
            style={{ "--tile-rot": rot, animationDelay: delay } as CSSProperties}
          >
            <Icon className="h-1/2 w-1/2" />
          </span>
        ))}
      </div>
    </div>
  );
}

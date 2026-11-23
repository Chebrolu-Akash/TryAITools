import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { Braces, Command, Music, PenLine, Play, Sparkles, type LucideIcon } from "lucide-react";

// Magnetic "joystick" response of the floating tiles: a tile within RADIUS px of a mouse cursor drifts away from it, at
// most MAX px from its own spot, and springs back when the cursor leaves. The offset goes in the CSS `translate`
// property, which composes with the float-tile keyframes' `transform`, so the floating animation keeps running.
const RADIUS = 110;
const MAX = 12;
const STIFFNESS = 0.06;
const DAMPING = 0.72; // ~0.5 s return with a barely visible settle (no wobble)

/** Attaches the cursor interaction to the tiles; mouse/trackpad only, and never with prefers-reduced-motion. */
function useMagneticTiles(tiles: RefObject<(HTMLSpanElement | null)[]>) {
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reduced.matches) return;

    const els = tiles.current ?? [];
    const state = els.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;

    const step = () => {
      frame = 0;
      let moving = false;
      let near = false;
      els.forEach((el, i) => {
        const s = state[i];
        if (!el || !s) return;
        let tx = 0;
        let ty = 0;
        // Hidden tiles (below lg) have no box: they stay at rest.
        if (pointer && el.offsetParent !== null) {
          const r = el.getBoundingClientRect();
          // The tile's own centre, without the offset this effect added.
          const dx = r.left + r.width / 2 - s.x - pointer.x;
          const dy = r.top + r.height / 2 - s.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < RADIUS) {
            near = true;
            const push = 1 - d / RADIUS; // 1 at the centre, 0 at the edge
            const mag = MAX * push * (2 - push); // ease-out, never above MAX
            const ux = d > 0.5 ? dx / d : 0;
            const uy = d > 0.5 ? dy / d : 0;
            tx = ux * mag;
            ty = uy * mag;
          }
        }
        s.vx = (s.vx + (tx - s.x) * STIFFNESS) * DAMPING;
        s.vy = (s.vy + (ty - s.y) * STIFFNESS) * DAMPING;
        s.x += s.vx;
        s.y += s.vy;
        // Keep the tile inside its circular boundary even while the spring settles.
        const m = Math.hypot(s.x, s.y);
        if (m > MAX) {
          s.x = (s.x / m) * MAX;
          s.y = (s.y / m) * MAX;
        }
        const resting =
          Math.abs(tx - s.x) < 0.05 &&
          Math.abs(ty - s.y) < 0.05 &&
          Math.abs(s.vx) < 0.05 &&
          Math.abs(s.vy) < 0.05;
        if (resting && tx === 0 && ty === 0) {
          s.x = s.y = s.vx = s.vy = 0;
          el.style.translate = "";
        } else {
          el.style.translate = `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`;
          if (!resting) moving = true;
        }
      });
      // Keep animating while something moves or a cursor is near; otherwise sleep until the next pointer event.
      if (moving || near) frame = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer = { x: e.clientX, y: e.clientY };
      kick();
    };
    const onLeave = () => {
      pointer = null;
      kick();
    };
    const onPref = () => {
      if (!finePointer.matches || reduced.matches) onLeave();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    reduced.addEventListener?.("change", onPref);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      reduced.removeEventListener?.("change", onPref);
      if (frame) cancelAnimationFrame(frame);
      els.forEach((el) => {
        if (el) el.style.translate = "";
      });
    };
  }, [tiles]);
}

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
  const tiles = useRef<(HTMLSpanElement | null)[]>([]);
  useMagneticTiles(tiles);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-hero-glows" />
      <div className="absolute inset-0 bg-grid-lines [mask-image:radial-gradient(ellipse_70%_60%_at_50%_42%,#000,transparent_75%)]" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1412 850"
        preserveAspectRatio="xMidYMid slice"
      >
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
            ref={(el) => {
              tiles.current[i] = el;
            }}
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

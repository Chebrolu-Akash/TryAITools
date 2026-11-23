// Public views of AI News: cards, the listing (landing and category pages) and the article page. Every summary is
// labelled as AI-generated and every article links to the original publisher. Links are plain <a> (full page loads), like
// the rest of the public site, because pages are served as static files by the gate where possible.
//
// Listing layout (editorial): a masthead with search and category tabs, a hero for the top story, then a hierarchy of
// secondary stories, a card grid and a compact "river" list, beside a sidebar (Trending, categories with counts, latest
// updates). Search results and later pages skip the hero.
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  FlaskConical,
  Flame,
  Info,
  Landmark,
  Newspaper,
  Rocket,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Page } from "@/components/site/Layout";
import { Crumbs } from "@/components/site/SectionLanding";
import { formatDate } from "@/components/site/ContentViews";
import {
  NEWS_CATEGORIES,
  NEWS_PATH,
  categoryLabel,
  relativeAge,
  newsArticlePath,
  newsCategoryPath,
  wordCount,
  type NewsCard,
  type NewsCategory,
  type NewsDetail,
} from "@/lib/news/model";

/**
 * A card's date: the publisher's original publication date, or "Added <date>" when the feed gave none (so the date
 * TryAITools collected it is never passed off as the publication date). The relative age ("3 hours ago", "Yesterday")
 * is added in the browser only: pages are pre-built, so an age rendered on the server would go stale.
 */
export function NewsDate({
  n,
  ageClassName = "text-primary",
}: {
  n: NewsCard;
  ageClassName?: string;
}) {
  const iso = n.sourcePublishedAt ?? n.publishedAt;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const age = now === null ? null : relativeAge(iso, now);
  return (
    <time
      dateTime={iso}
      title={n.sourcePublishedAt ? "Published by the source" : "Added to TryAITools"}
      className="whitespace-nowrap"
    >
      {n.sourcePublishedAt ? "" : "Added "}
      {formatDate(iso)}
      {age && <span className={`font-semibold ${ageClassName}`}> · {age}</span>}
    </time>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Branded fallback artwork: abstract, never a stock photo, so a story without an image is never shown with an unrelated
// or misleading picture. The palette and icon come from the category; the pattern and glow position from a hash of the
// slug, so neighbouring placeholders differ.

const CATEGORY_ART: Record<NewsCategory, { gradient: string; icon: LucideIcon }> = {
  "model-releases": { gradient: "from-[#2e2690] via-[#4f46e5] to-[#8b7bff]", icon: Cpu },
  "tool-launches": { gradient: "from-[#3b1a7a] via-[#6d3ae0] to-[#b892ff]", icon: Rocket },
  "company-news": { gradient: "from-[#1b2340] via-[#33427e] to-[#6b74e8]", icon: Building2 },
  research: { gradient: "from-[#0e3a4a] via-[#1d5f7f] to-[#6a86f0]", icon: FlaskConical },
  "business-funding": { gradient: "from-[#123a36] via-[#1f6a5c] to-[#6fc4ae]", icon: TrendingUp },
  "regulation-policy": { gradient: "from-[#2c2346] via-[#5d4377] to-[#c991a6]", icon: Landmark },
};

function hashOf(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  // Final mix, so slugs that differ only in their last characters still land on different patterns.
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

const GLOWS = ["18% 22%", "82% 18%", "75% 80%", "25% 78%", "50% 35%"];

function ArtPattern({ variant }: { variant: number }) {
  const common = {
    "aria-hidden": true,
    className: "absolute inset-0 h-full w-full",
    viewBox: "0 0 400 225",
    preserveAspectRatio: "xMidYMid slice",
    fill: "none",
    stroke: "white",
  } as const;
  switch (variant) {
    case 0: // concentric rings
      return (
        <svg {...common} strokeOpacity="0.16">
          {[30, 60, 90, 120, 150, 180, 210].map((r) => (
            <circle key={r} cx="310" cy="60" r={r} />
          ))}
        </svg>
      );
    case 1: // fine grid
      return (
        <svg {...common} strokeOpacity="0.12">
          {Array.from({ length: 14 }, (_, i) => (
            <line key={`v${i}`} x1={i * 30} y1="0" x2={i * 30} y2="225" />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={i * 30} x2="400" y2={i * 30} />
          ))}
        </svg>
      );
    case 2: // diagonal hatching
      return (
        <svg {...common} strokeOpacity="0.12">
          {Array.from({ length: 22 }, (_, i) => (
            <line key={i} x1={i * 28 - 225} y1="225" x2={i * 28} y2="0" />
          ))}
        </svg>
      );
    default: // flowing waves
      return (
        <svg {...common} strokeOpacity="0.18">
          {Array.from({ length: 9 }, (_, i) => (
            <path
              key={i}
              d={`M0 ${40 + i * 20} C 100 ${10 + i * 20}, 200 ${90 + i * 20}, 400 ${30 + i * 20}`}
            />
          ))}
        </svg>
      );
  }
}

/**
 * An article image in a fixed-ratio frame. The branded artwork (category gradient, pattern, icon) is always drawn first,
 * and the image covers it once loaded. If there is no image, or it fails (blocked, 404, offline), the image is removed
 * and the artwork stays: never a broken-image icon or an empty box. Decorative (alt=""): the headline says it all.
 */
export function NewsImage({
  src,
  className,
  eager = false,
  large = false,
  category = "model-releases",
  seed = "",
  zoom = false,
}: {
  src: string | null;
  className: string;
  eager?: boolean;
  large?: boolean;
  category?: NewsCategory;
  seed?: string;
  /** Scale the image slightly when the surrounding `.group` is hovered. */
  zoom?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image that already failed before hydration never fires React's onError: check once on mount.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  const art = CATEGORY_ART[category] ?? CATEGORY_ART["model-releases"];
  const h = hashOf(seed || category);
  const Icon = art.icon;
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${art.gradient} ${className}`}>
      <div aria-hidden className="absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(60% 70% at ${GLOWS[h % GLOWS.length]}, rgb(255 255 255 / 0.22), transparent 70%)`,
          }}
        />
        <ArtPattern variant={(h >> 3) % 4} />
        <div className="absolute inset-0 grid place-items-center">
          <span
            className={`grid place-items-center rounded-xl bg-white/12 text-white ring-1 ring-white/25 backdrop-blur-sm ${
              large ? "h-16 w-16" : "h-11 w-11"
            }`}
          >
            <Icon className={large ? "h-8 w-8" : "h-5 w-5"} strokeWidth={1.75} />
          </span>
        </div>
        {large && (
          <span className="absolute bottom-4 left-4 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/70">
            TryAITools · AI News · {categoryLabel(category)}
          </span>
        )}
      </div>
      {src && !failed && (
        <img
          ref={ref}
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${
            zoom
              ? "transition-transform duration-500 ease-out group-hover:scale-[1.035] motion-reduce:transition-none"
              : ""
          }`}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Small shared pieces

const Dot = () => (
  <span aria-hidden className="text-current opacity-40">
    •
  </span>
);

function Kicker({ n, className = "text-primary" }: { n: NewsCard; className?: string }) {
  return (
    <a
      href={newsCategoryPath(n.category)}
      className={`relative z-10 text-[0.7rem] font-bold uppercase tracking-[0.12em] hover:underline ${className}`}
    >
      {categoryLabel(n.category)}
    </a>
  );
}

function PickBadge() {
  return (
    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-primary">
      Editor&apos;s pick
    </span>
  );
}

/** Publisher, date and reading time. */
function Meta({
  n,
  dark = false,
  compact = false,
}: {
  n: NewsCard;
  dark?: boolean;
  /** Small cards: publisher and date only, so the line does not wrap. */
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${
        dark ? "text-white/65" : "text-muted-foreground"
      }`}
    >
      <span className={`font-semibold ${dark ? "text-white" : "text-foreground"}`}>
        {n.sourceName}
      </span>
      <Dot />
      <NewsDate n={n} ageClassName={dark ? "text-white/90" : "text-primary"} />
      {n.readMinutes && !compact ? (
        <>
          <Dot />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Clock aria-hidden className="h-3 w-3" />
            {n.readMinutes} min read
          </span>
        </>
      ) : null}
    </div>
  );
}

function SectionRule({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <h2
        id={id}
        className="shrink-0 text-xs font-bold uppercase tracking-[0.16em] text-foreground"
      >
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

const CARD_BASE =
  "group relative overflow-hidden rounded-lg border border-border bg-card shadow-card transition duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_40px_-24px_rgb(40_30_110/0.45)] motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** The headline link; its ::after covers the whole card so the card is one click target (category link stays on top). */
function HeadlineLink({ n, className = "" }: { n: NewsCard; className?: string }) {
  return (
    <a
      href={newsArticlePath(n.slug)}
      className={`after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-primary ${className}`}
    >
      {n.title}
    </a>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Cards

/**
 * A news card. `feature` makes a larger card (secondary stories). `lead` and `wide` span both grid columns and lay out
 * image and text side by side from md up, so a grid never ends in a half-empty row.
 */
export function NewsCardView({
  n,
  lead = false,
  wide = false,
  feature = false,
}: {
  n: NewsCard;
  lead?: boolean;
  wide?: boolean;
  feature?: boolean;
}) {
  const across = lead || wide;
  const big = lead || feature;
  return (
    <article
      className={`${CARD_BASE} flex flex-col ${across ? "sm:col-span-2 md:grid md:grid-cols-2" : ""}`}
    >
      <NewsImage
        src={n.imageUrl}
        category={n.category}
        seed={n.slug}
        zoom
        className={
          across
            ? "aspect-[16/9] w-full md:aspect-auto md:h-full md:min-h-[16rem]"
            : "aspect-[16/9] w-full"
        }
        eager={lead}
      />
      <div className={`flex flex-1 flex-col ${big ? "gap-3 p-5 sm:p-6" : "gap-2 p-4 sm:p-5"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Kicker n={n} />
          {n.featured && <PickBadge />}
        </div>
        <h3
          className={`font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary ${
            lead
              ? "text-2xl sm:text-[1.7rem]"
              : big
                ? "text-xl sm:text-[1.4rem]"
                : wide
                  ? "text-lg"
                  : "text-[1.05rem]"
          }`}
        >
          <HeadlineLink n={n} />
        </h3>
        <p
          className={`text-foreground/70 ${big ? "text-[0.95rem] leading-relaxed" : "line-clamp-3 text-sm leading-relaxed"}`}
        >
          {n.description}
        </p>
        <div className="mt-auto pt-2">
          <Meta n={n} compact={!big && !across} />
        </div>
      </div>
    </article>
  );
}

/** A compact horizontal story for the "river" list and search results. */
function NewsRiverItem({ n }: { n: NewsCard }) {
  return (
    <article className="group relative grid grid-cols-[minmax(0,1fr)_7rem] gap-4 border-b border-border py-5 first:pt-0 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <NewsImage
        src={n.imageUrl}
        category={n.category}
        seed={n.slug}
        zoom
        className="order-last aspect-[16/9] w-full self-start rounded-md sm:order-first"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Kicker n={n} />
          {n.featured && <PickBadge />}
        </div>
        <h3 className="text-base font-bold leading-snug tracking-tight transition-colors group-hover:text-primary sm:text-lg">
          <HeadlineLink n={n} />
        </h3>
        <p className="line-clamp-2 hidden text-sm leading-relaxed text-foreground/70 sm:block">
          {n.description}
        </p>
        <div className="mt-1">
          <Meta n={n} compact />
        </div>
      </div>
    </article>
  );
}

/** The top story: large image, headline, summary, attribution and a clear call to action on a dark gradient. */
function NewsHero({ n }: { n: NewsCard }) {
  return (
    <section aria-labelledby="top-story" className="page-container pt-8">
      <article
        className="group relative grid overflow-hidden rounded-xl text-white shadow-[0_30px_60px_-30px_rgb(30_20_90/0.6)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        style={{
          background:
            "radial-gradient(80% 90% at 0% 0%, rgb(124 108 255 / 0.35), transparent 60%), radial-gradient(70% 80% at 100% 100%, rgb(70 130 255 / 0.18), transparent 60%), linear-gradient(135deg, #14112e 0%, #1c1745 55%, #121029 100%)",
        }}
      >
        <div className="relative order-last flex flex-col justify-center gap-4 p-6 sm:p-8 lg:order-first lg:p-10 xl:p-12">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-2 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-white ring-1 ring-white/15">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#9d8cff]" />
              Top story
            </span>
            <Kicker n={n} className="text-[#b9adff]" />
          </div>
          <h2
            id="top-story"
            className="text-[1.75rem] font-bold leading-[1.15] tracking-tight sm:text-4xl xl:text-[2.75rem]"
          >
            <a
              href={newsArticlePath(n.slug)}
              className="decoration-white/40 underline-offset-4 hover:underline"
            >
              {n.title}
            </a>
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
            {n.description}
          </p>
          <Meta n={n} dark />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href={newsArticlePath(n.slug)}
              className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-2.5 text-sm font-bold text-[#1c1745] shadow-sm transition hover:bg-white/90"
            >
              Read article <ArrowRight aria-hidden className="h-4 w-4" />
            </a>
            <a
              href={newsCategoryPath(n.category)}
              className="inline-flex items-center gap-1 rounded-md px-3 py-2.5 text-sm font-semibold text-white/80 ring-1 ring-white/20 transition hover:bg-white/10 hover:text-white"
            >
              More {categoryLabel(n.category)}
            </a>
          </div>
        </div>
        <a
          href={newsArticlePath(n.slug)}
          tabIndex={-1}
          aria-hidden
          className="relative block overflow-hidden lg:min-h-[24rem]"
        >
          <NewsImage
            src={n.imageUrl}
            category={n.category}
            seed={n.slug}
            eager
            large
            zoom
            className="aspect-[16/9] h-full w-full lg:absolute lg:inset-0 lg:aspect-auto"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-[#17133a]/60 via-transparent to-transparent lg:block"
          />
        </a>
      </article>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Navigation, search, pagination

// The masthead's category chips and search box keep the original AI News design.
function CategoryNav({ active }: { active: NewsCategory | null }) {
  const chip = (href: string, label: string, on: boolean) => (
    <a
      key={href}
      href={href}
      aria-current={on ? "page" : undefined}
      className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:border-primary/40 hover:text-primary"
      }`}
    >
      {label}
    </a>
  );
  return (
    <nav aria-label="News categories" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {chip(NEWS_PATH, "All news", active === null)}
      {NEWS_CATEGORIES.map((c) => chip(newsCategoryPath(c.slug), c.label, active === c.slug))}
    </nav>
  );
}

function SearchBox({ action, q }: { action: string; q: string }) {
  return (
    <form action={action} method="get" role="search" className="w-full max-w-sm">
      <label className="relative block text-sm">
        <span className="sr-only">Search AI news</span>
        <Search
          aria-hidden
          className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={80}
          placeholder="Search AI news…"
          className="w-full rounded-full border border-border bg-background py-2.5 pl-10 pr-4 outline-none focus:border-primary"
        />
      </label>
    </form>
  );
}

function Pager({
  base,
  page,
  hasMore,
  q,
}: {
  base: string;
  page: number;
  hasMore: boolean;
  q: string;
}) {
  if (page === 1 && !hasMore) return null;
  const href = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const cls =
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-card transition hover:border-primary/40 hover:text-primary";
  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex items-center justify-between gap-3 border-t border-border pt-6"
    >
      {page > 1 ? (
        <a href={href(page - 1)} rel="prev" className={cls}>
          <ChevronLeft aria-hidden className="h-4 w-4" /> Newer
        </a>
      ) : (
        <span />
      )}
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Page {page}
      </span>
      {hasMore ? (
        <a href={href(page + 1)} rel="next" className={cls}>
          Older <ChevronRight aria-hidden className="h-4 w-4" />
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Sidebar

function SideBox({
  id,
  title,
  icon,
  note,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-border bg-card p-5 shadow-card"
    >
      <h2
        id={id}
        className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground"
      >
        {icon}
        {title}
      </h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TrendingBox({ items }: { items: NewsCard[] }) {
  return (
    <SideBox
      id="trending-heading"
      title="Trending"
      icon={<Flame aria-hidden className="h-4 w-4 text-primary" />}
      note="This week, ranked by editor's picks and how many outlets covered the story."
    >
      <ol className="divide-y divide-border">
        {items.map((n, i) => (
          <li key={n.slug} className="group relative flex gap-3 py-3 first:pt-0 last:pb-0">
            <span
              aria-hidden
              className="w-6 shrink-0 font-display text-2xl font-bold leading-none text-primary/35 transition-colors group-hover:text-primary"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-primary">
                {categoryLabel(n.category)}
              </p>
              <a
                href={newsArticlePath(n.slug)}
                className="mt-0.5 block text-sm font-semibold leading-snug transition-colors after:absolute after:inset-0 group-hover:text-primary"
              >
                {n.title}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.sourceName} · {formatDate(n.sourcePublishedAt ?? n.publishedAt)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </SideBox>
  );
}

function CategoriesBox({
  active,
  counts,
}: {
  active: NewsCategory | null;
  counts: Partial<Record<NewsCategory, number>>;
}) {
  return (
    <SideBox id="categories-heading" title="Categories">
      <ul className="-mx-2 space-y-0.5">
        {NEWS_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ART[c.slug].icon;
          const on = active === c.slug;
          return (
            <li key={c.slug}>
              <a
                href={newsCategoryPath(c.slug)}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-semibold transition-colors ${
                  on ? "bg-primary/10 text-primary" : "hover:bg-secondary hover:text-primary"
                }`}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0 opacity-70" />
                <span className="flex-1">{c.label}</span>
                {counts[c.slug] ? (
                  <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[0.7rem] font-bold tabular-nums text-muted-foreground">
                    {counts[c.slug]}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </SideBox>
  );
}

function LatestBox({ items, title }: { items: NewsCard[]; title: string }) {
  return (
    <SideBox id="latest-updates-heading" title={title}>
      <ol className="relative space-y-4 border-l border-border pl-4">
        {items.map((n) => (
          <li key={n.slug} className="group relative">
            <span
              aria-hidden
              className="absolute -left-[calc(1rem+4.5px)] top-1.5 h-2 w-2 rounded-full border-2 border-background bg-primary/50 transition-colors group-hover:bg-primary"
            />
            <p className="text-[0.7rem] text-muted-foreground">
              <NewsDate n={n} />
            </p>
            <a
              href={newsArticlePath(n.slug)}
              className="mt-0.5 block text-sm font-semibold leading-snug transition-colors hover:text-primary"
            >
              {n.title}
            </a>
          </li>
        ))}
      </ol>
    </SideBox>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Listing

export const AI_NOTICE =
  "Summaries are written by AI (Google Gemini) from the publisher's own feed and link to the original article. Always check the source for full details.";

/** The top story of a first page: the newest editor's pick, else the newest story with an image among the first few. */
function pickHero(items: NewsCard[]): number {
  const pick = items.findIndex((n) => n.featured);
  if (pick >= 0) return pick;
  const withImage = items.slice(0, 4).findIndex((n) => n.imageUrl);
  return withImage >= 0 ? withImage : 0;
}

export function NewsListing({
  category,
  items,
  trending,
  latest = [],
  counts = {},
  page,
  hasMore,
  q,
}: {
  category: NewsCategory | null;
  items: NewsCard[];
  trending: NewsCard[];
  latest?: NewsCard[];
  counts?: Partial<Record<NewsCategory, number>>;
  page: number;
  hasMore: boolean;
  q: string;
}) {
  const base = category ? newsCategoryPath(category) : NEWS_PATH;
  const label = category ? categoryLabel(category) : null;
  const searching = q !== "";

  // Story hierarchy: hero (first page, no search) → two secondary stories → card grid → river list.
  let hero: NewsCard | null = null;
  let pool = items;
  if (!searching && page === 1 && items.length > 0) {
    const h = pickHero(items);
    hero = items[h]!;
    pool = items.filter((_, i) => i !== h);
  }
  // The two secondary slots prefer the newest stories with a real image (among the next six); order is otherwise kept.
  let secondary: NewsCard[] = [];
  if (hero) {
    const next = pool.slice(0, 6);
    secondary = [...next.filter((n) => n.imageUrl), ...next.filter((n) => !n.imageUrl)].slice(0, 2);
  }
  const rest = pool.filter((n) => !secondary.includes(n));
  const gridN = searching
    ? 0
    : rest.length >= 6
      ? 6
      : rest.length >= 4
        ? 4
        : rest.length >= 2
          ? 2
          : 0;
  const grid = rest.slice(0, gridN);
  const river = rest.slice(gridN);

  const onPage = new Set(items.map((n) => n.slug));
  const notOnPage = latest.filter((n) => !onPage.has(n.slug));
  // A first page holding only its top story (a quiet category) continues with the latest news from every category.
  const fillIn = hero && pool.length === 0 ? notOnPage.slice(0, 4) : [];
  const latestRail = notOnPage.slice(fillIn.length, fillIn.length + 6);
  const latestTitle = category
    ? "Latest across AI News"
    : latest.some((n) => onPage.has(n.slug))
      ? "Earlier updates"
      : "Latest updates";

  return (
    <Page>
      {/* Masthead: the original AI News design (gradient, title, search, notice, category chips). */}
      <section className="bg-hero pb-10 pt-14">
        <div className="page-container">
          <Crumbs
            trail={
              category
                ? [{ label: "AI News", href: NEWS_PATH }, { label: label! }]
                : [{ label: "AI News" }]
            }
          />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 flex-[1_1_480px]">
              <h1 className="text-4xl font-bold sm:text-5xl">
                {category ? `${label} — AI News` : "AI News"}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-foreground/75 sm:text-lg">
                {category
                  ? `The latest ${label!.toLowerCase()} from official AI company blogs and trusted outlets, summarised.`
                  : "Model releases, tool launches, research and policy from official AI company blogs and trusted outlets, summarised every few hours."}
              </p>
            </div>
            <SearchBox action={base} q={q} />
          </div>
          <p className="mt-5 inline-flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{AI_NOTICE}</span>
          </p>
          <div className="mt-6">
            <CategoryNav active={category} />
          </div>
        </div>
      </section>

      {hero && <NewsHero n={hero} />}

      <div className="page-container grid gap-10 pb-16 pt-10 lg:grid-cols-[minmax(0,1fr)_20rem] xl:gap-12">
        <div className="min-w-0">
          {searching && (
            <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Results for “{q}”</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {items.length === 0
                    ? "No stories match"
                    : `${hasMore || page > 1 ? `Page ${page} · ` : ""}${items.length}${hasMore ? "+" : ""} ${
                        items.length === 1 ? "story" : "stories"
                      }`}
                  {label ? ` in ${label}` : " across all categories"}
                </p>
              </div>
              <div className="flex gap-4 text-sm font-semibold">
                {category && (
                  <a
                    href={`${NEWS_PATH}?q=${encodeURIComponent(q)}`}
                    className="text-primary hover:underline"
                  >
                    Search all news
                  </a>
                )}
                <a href={base} className="text-muted-foreground hover:text-foreground">
                  Clear search
                </a>
              </div>
            </header>
          )}

          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-primary/25 bg-secondary px-6 py-14 text-center">
              <Newspaper aria-hidden className="mx-auto h-8 w-8 text-primary/60" />
              <h3 className="mt-3 text-xl font-bold">
                {searching ? "No matching news" : "No news here yet"}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                {searching
                  ? "Try a shorter search, or browse a category."
                  : "New stories are collected every few hours. Check back soon."}
              </p>
            </div>
          ) : (
            <div className="space-y-12">
              {secondary.length > 0 && (
                <section aria-labelledby="top-stories">
                  <SectionRule id="top-stories">Top stories</SectionRule>
                  <div className="grid gap-6 sm:grid-cols-2">
                    {secondary.map((n) => (
                      <NewsCardView key={n.slug} n={n} feature wide={secondary.length === 1} />
                    ))}
                  </div>
                </section>
              )}
              {grid.length > 0 && (
                <section aria-labelledby="latest-heading">
                  <SectionRule id="latest-heading">
                    {label ? `Latest in ${label}` : "Latest AI news"}
                    {page > 1 ? ` · Page ${page}` : ""}
                  </SectionRule>
                  <div
                    className={`grid gap-6 sm:grid-cols-2 ${grid.length === 6 ? "xl:grid-cols-3" : ""}`}
                  >
                    {grid.map((n) => (
                      <NewsCardView key={n.slug} n={n} />
                    ))}
                  </div>
                </section>
              )}
              {fillIn.length > 0 && (
                <section aria-labelledby="across-news">
                  <SectionRule id="across-news">Latest across AI News</SectionRule>
                  <p className="-mt-2 mb-5 text-sm text-muted-foreground">
                    That&apos;s the only {label ? label.toLowerCase() : "AI news"} story so far.
                    More from other categories:
                  </p>
                  <div className="grid gap-6 sm:grid-cols-2">
                    {fillIn.map((n) => (
                      <NewsCardView key={n.slug} n={n} />
                    ))}
                  </div>
                </section>
              )}
              {river.length > 0 && (
                <section aria-labelledby={searching ? undefined : "more-news"}>
                  {!searching && <SectionRule id="more-news">More stories</SectionRule>}
                  <div>
                    {river.map((n) => (
                      <NewsRiverItem key={n.slug} n={n} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          <Pager base={base} page={page} hasMore={hasMore} q={q} />
        </div>

        <aside className="space-y-6">
          {trending.length > 0 && <TrendingBox items={trending} />}
          <CategoriesBox active={category} counts={counts} />
          {latestRail.length > 0 && <LatestBox items={latestRail} title={latestTitle} />}
        </aside>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Article page

export function NewsArticleView({ a, related }: { a: NewsDetail; related: NewsCard[] }) {
  const paragraphs = a.summary.split(/\n\s*\n/).filter(Boolean);
  const minutes = Math.max(1, Math.round(wordCount(a.summary) / 220));
  return (
    <Page>
      <section className="border-b border-border bg-gradient-to-b from-secondary via-background to-background">
        <div className="mx-auto max-w-4xl pb-8 pt-10 page-x sm:pt-12">
          <Crumbs
            trail={[
              { label: "AI News", href: NEWS_PATH },
              { label: categoryLabel(a.category), href: newsCategoryPath(a.category) },
              { label: a.title },
            ]}
          />
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <a
              href={newsCategoryPath(a.category)}
              className="text-xs font-bold uppercase tracking-[0.14em] text-primary hover:underline"
            >
              {categoryLabel(a.category)}
            </a>
            {a.featured && <PickBadge />}
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl lg:text-[2.75rem]">
            {a.title}
          </h1>
          {a.description && (
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-foreground/70">
              {a.description}
            </p>
          )}
          <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Source: <span className="font-semibold text-foreground">{a.sourceName}</span>
              {a.sourcePublishedAt ? ` · Published ${formatDate(a.sourcePublishedAt)}` : ""} ·
              Summarised {formatDate(a.publishedAt > a.collectedAt ? a.publishedAt : a.collectedAt)}{" "}
              · {minutes} min read
            </p>
            <a
              href={a.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-gradient-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
            >
              Read the original on {a.sourceName} <ArrowUpRight aria-hidden className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-4xl pb-20 pt-8 page-x">
        <NewsImage
          src={a.imageUrl}
          category={a.category}
          seed={a.slug}
          className="mb-8 aspect-[16/9] max-h-[28rem] w-full rounded-lg border border-border"
          eager
          large
        />
        <div
          role="note"
          className="mb-8 flex max-w-3xl items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
        >
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>AI-generated summary.</strong> This summary was written by AI (Google Gemini)
            using only the text {a.sourceName} published in its feed. It may omit details; read the{" "}
            <a
              href={a.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline"
            >
              original article
            </a>{" "}
            for the full story.
          </span>
        </div>
        <article className="max-w-3xl space-y-5 text-lg leading-[1.75] text-foreground/90">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </article>
        {a.takeaways.length > 0 && (
          <section
            aria-labelledby="takeaways"
            className="mt-10 max-w-3xl rounded-lg border border-border border-l-4 border-l-primary bg-card p-6 shadow-card"
          >
            <h2
              id="takeaways"
              className="text-xs font-bold uppercase tracking-[0.16em] text-foreground"
            >
              Key takeaways
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-primary">
              {a.takeaways.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        )}
        {(a.tags.length > 0 || a.companies.length > 0) && (
          <div className="mt-6 flex max-w-3xl flex-wrap gap-2">
            {[...new Set([...a.companies, ...a.products, ...a.tags])].slice(0, 12).map((t) => (
              <a
                key={t}
                href={`${NEWS_PATH}?q=${encodeURIComponent(t)}`}
                rel="nofollow"
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary"
              >
                {t}
              </a>
            ))}
          </div>
        )}
        <p className="mt-8 max-w-3xl text-sm text-muted-foreground">
          Original source:{" "}
          <a
            href={a.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary hover:underline"
          >
            {a.sourceName}
          </a>
          . TryAITools is not affiliated with {a.sourceName}; all trademarks belong to their owners.
        </p>
        {related.length > 0 && (
          <section aria-labelledby="related-news" className="mt-14">
            <SectionRule id="related-news">Related news</SectionRule>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((n) => (
                <NewsCardView key={n.slug} n={n} />
              ))}
            </div>
          </section>
        )}
        <a
          href={NEWS_PATH}
          className="mt-10 inline-flex text-sm font-semibold text-primary hover:underline"
        >
          ← All AI News
        </a>
      </div>
    </Page>
  );
}

export function NewsNotFound() {
  return (
    <Page>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">Article not found</h1>
        <p className="mt-3 text-muted-foreground">
          It may have been removed or is no longer available.
        </p>
        <a
          href={NEWS_PATH}
          className="mt-6 inline-flex rounded-md bg-gradient-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-soft"
        >
          Read the latest AI news
        </a>
      </div>
    </Page>
  );
}

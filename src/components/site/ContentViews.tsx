// Public views of the content sections: listing grids with client-side filters, and the detail page layout. Data comes
// from src/lib/content (public fields only). Every affiliate or sponsor link is rel="sponsored nofollow" and opens in a
// new tab; every sponsored page and card says so in words, not only by colour.
import { ArrowUpRight, BookOpen, Clock, GraduationCap, Info, PlayCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { MarkdownView } from "@/components/admin/MarkdownView";
import { Page } from "@/components/site/Layout";
import { Crumbs } from "@/components/site/SectionLanding";
import {
  GADGET_TYPES,
  LEARN_PATH,
  learnPathOf,
  LEVELS,
  type LearnKind,
  type TutorialCard,
  type CourseCard,
  type GadgetCard,
  type GuestCard,
  type PostCard,
  type PublicImage,
} from "@/lib/content/model";

export const SPONSORED_REL = "sponsored nofollow noopener noreferrer";
const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
};

function Img({
  image,
  className,
  eager,
}: {
  image: PublicImage | null;
  className: string;
  eager?: boolean;
}) {
  if (!image)
    return (
      <div aria-hidden className={`${className} bg-gradient-to-br from-secondary to-primary/20`} />
    );
  return (
    <img
      src={image.url}
      alt={image.alt}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`${className} object-cover`}
    />
  );
}

export function AffiliateButton({
  href,
  children,
  subtle,
}: {
  href: string;
  children: ReactNode;
  subtle?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel={SPONSORED_REL}
      className={
        subtle
          ? "inline-flex items-center gap-1 rounded-full bg-secondary px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/15"
          : "inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
      }
    >
      {children}
      <ArrowUpRight aria-hidden className="h-4 w-4" />
    </a>
  );
}

export function SponsoredBadge({ label = "Sponsored" }: { label?: string }) {
  return (
    <span className="inline-flex rounded-md bg-[#FFF1D6] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#7A4A00]">
      {label}
    </span>
  );
}

const chip = "rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold text-secondary-foreground";

function Toggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
            value === v
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground/80 hover:border-primary/40"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const Grid = ({ children, narrow }: { children: ReactNode; narrow?: boolean }) => (
  <div
    className={`grid gap-5 ${narrow ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}
  >
    {children}
  </div>
);
const Wrap = ({ children }: { children: ReactNode }) => (
  <div className="page-container space-y-10 pb-20 pt-10">{children}</div>
);
const NoMatch = () => (
  <p className="rounded-2xl border border-dashed border-primary/25 bg-secondary px-6 py-10 text-center text-muted-foreground">
    Nothing matches this filter yet.
  </p>
);

// ------------------------------------------------------------------ AI Learning Hub (courses, books, tutorials)

const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
const opts = (all: string, xs: string[]): [string, string][] => [
  ["all", all],
  ...xs.map((x): [string, string] => [x, x]),
];
const priceOk = (price: string, isFree: boolean) =>
  price === "any" || (price === "free" ? isFree : !isFree);
const PRICE_OPTIONS: [string, string][] = [
  ["any", "Free & paid"],
  ["free", "Free"],
  ["paid", "Paid"],
];

/** The filters row: only the groups the data can support (a group with one choice is hidden). */
function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-3">{children}</div>;
}

export function CourseCardView({ c }: { c: CourseCard }) {
  return (
    <article className="tool-card overflow-hidden p-0">
      <Img image={c.image} className="h-36 w-full" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap gap-1.5">
          <span className={chip}>{LEVELS[c.level]}</span>
          {c.format && <span className={chip}>{c.format}</span>}
          {c.isFree && <span className={chip}>Free</span>}
        </div>
        <h3 className="text-base font-bold leading-snug">
          <a href={learnPathOf("course", c.slug)} className="hover:text-primary">
            {c.title}
          </a>
        </h3>
        {c.summary && <p className="line-clamp-2 text-sm text-foreground/75">{c.summary}</p>}
        <p className="text-xs text-muted-foreground">
          {[c.provider, c.duration].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="font-bold">{c.price}</span>
          <a
            href={learnPathOf("course", c.slug)}
            className="text-sm font-semibold text-primary hover:underline"
          >
            Details
          </a>
        </div>
      </div>
    </article>
  );
}

export function BookCardView({ b }: { b: CourseCard }) {
  return (
    <article className="flex flex-col gap-2.5">
      <a href={learnPathOf("book", b.slug)} className="block" tabIndex={-1} aria-hidden>
        {b.image ? (
          <Img image={b.image} className="aspect-[2/3] w-full rounded-2xl shadow-soft" />
        ) : (
          <div className="flex aspect-[2/3] flex-col justify-end rounded-2xl bg-gradient-to-br from-[#2E2A6E] to-primary p-4 text-primary-foreground shadow-soft">
            <span className="text-lg font-semibold leading-tight">{b.title}</span>
            {b.provider && <span className="mt-1 text-xs opacity-80">{b.provider}</span>}
          </div>
        )}
      </a>
      <h3 className="text-sm font-bold">
        <a href={learnPathOf("book", b.slug)} className="hover:text-primary">
          {b.title}
        </a>
      </h3>
      <p className="text-xs text-muted-foreground">
        {[b.provider, b.isFree ? "Free" : b.price].filter(Boolean).join(" · ")}
      </p>
      {b.summary && <p className="line-clamp-2 text-xs text-foreground/70">{b.summary}</p>}
    </article>
  );
}

export function TutorialCardView({ t }: { t: TutorialCard }) {
  return (
    <article className="tool-card overflow-hidden p-0">
      <Img image={t.image} className="h-32 w-full" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap gap-1.5">
          <span className={chip}>{LEVELS[t.difficulty]}</span>
          {t.format && <span className={chip}>{t.format}</span>}
          {t.isFree && <span className={chip}>Free</span>}
        </div>
        <h3 className="text-base font-bold leading-snug">
          <a href={learnPathOf("tutorial", t.slug)} className="hover:text-primary">
            {t.title}
          </a>
        </h3>
        {t.summary && <p className="line-clamp-2 text-sm text-foreground/75">{t.summary}</p>}
        <p className="mt-auto pt-2 text-xs text-muted-foreground">
          {[t.author, t.duration].filter(Boolean).join(" · ")}
        </p>
      </div>
    </article>
  );
}

export function CoursesList({ items }: { items: CourseCard[] }) {
  const [level, setLevel] = useState("any");
  const [price, setPrice] = useState("any");
  const [topic, setTopic] = useState("all");
  const levels = uniq(items.map((c) => c.level));
  const topics = uniq(items.flatMap((c) => c.topics));
  const hasBoth = items.some((c) => c.isFree) && items.some((c) => !c.isFree);
  const shown = items.filter(
    (c) =>
      (level === "any" || c.level === level) &&
      priceOk(price, c.isFree) &&
      (topic === "all" || c.topics.includes(topic)),
  );
  const filtered = level !== "any" || price !== "any" || topic !== "all";
  const pick = filtered ? undefined : shown.find((c) => c.featured);
  const rest = shown.filter((c) => c !== pick);
  return (
    <Wrap>
      <FilterBar>
        {levels.length > 1 && (
          <Toggle
            label="Level"
            value={level}
            onChange={setLevel}
            options={[
              ["any", "Any level"],
              ...levels.map((l): [string, string] => [l, LEVELS[l] ?? l]),
            ]}
          />
        )}
        {hasBoth && (
          <Toggle label="Price" value={price} onChange={setPrice} options={PRICE_OPTIONS} />
        )}
        {topics.length > 1 && (
          <Toggle
            label="Topic"
            value={topic}
            onChange={setTopic}
            options={opts("All topics", topics)}
          />
        )}
      </FilterBar>
      {shown.length === 0 && <NoMatch />}
      {pick && (
        <article className="flex flex-wrap gap-7 rounded-3xl border border-primary/15 bg-secondary/60 p-6 sm:p-7">
          <Img image={pick.image} className="min-h-52 flex-[1_1_300px] rounded-2xl" eager />
          <div className="flex flex-[2_1_380px] flex-col justify-center gap-2.5">
            <span className="self-start rounded-full bg-background px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              Featured course
            </span>
            <h2 className="text-3xl font-bold">
              <a href={learnPathOf("course", pick.slug)} className="hover:text-primary">
                {pick.title}
              </a>
            </h2>
            <p className="text-sm text-muted-foreground">
              {[pick.provider, pick.format, pick.duration, LEVELS[pick.level]]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {pick.summary && <p className="text-foreground/80">{pick.summary}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <a
                href={learnPathOf("course", pick.slug)}
                className="inline-flex items-center rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
              >
                See the course
              </a>
              {pick.price && <span className="text-xl font-bold">{pick.price}</span>}
            </div>
          </div>
        </article>
      )}
      {rest.length > 0 && (
        <Grid>
          {rest.map((c) => (
            <CourseCardView key={c.slug} c={c} />
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

export function BooksList({ items }: { items: CourseCard[] }) {
  const [topic, setTopic] = useState("all");
  const [author, setAuthor] = useState("all");
  const [price, setPrice] = useState("any");
  const topics = uniq(items.flatMap((b) => b.topics));
  const authors = uniq(items.map((b) => b.provider));
  const hasBoth = items.some((b) => b.isFree) && items.some((b) => !b.isFree);
  const shown = items.filter(
    (b) =>
      (topic === "all" || b.topics.includes(topic)) &&
      (author === "all" || b.provider === author) &&
      priceOk(price, b.isFree),
  );
  return (
    <Wrap>
      <FilterBar>
        {topics.length > 1 && (
          <Toggle
            label="Topic"
            value={topic}
            onChange={setTopic}
            options={opts("All topics", topics)}
          />
        )}
        {authors.length > 1 && (
          <label className="text-sm font-semibold">
            <span className="sr-only">Author</span>
            <select
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="rounded-full border border-border bg-background px-4 py-2 text-sm"
            >
              <option value="all">All authors</option>
              {authors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}
        {hasBoth && (
          <Toggle label="Price" value={price} onChange={setPrice} options={PRICE_OPTIONS} />
        )}
      </FilterBar>
      {shown.length === 0 ? (
        <NoMatch />
      ) : (
        <Grid narrow>
          {shown.map((b) => (
            <BookCardView key={b.slug} b={b} />
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

export function TutorialsList({ items }: { items: TutorialCard[] }) {
  const [difficulty, setDifficulty] = useState("any");
  const [topic, setTopic] = useState("all");
  const levels = (["beginner", "intermediate", "advanced"] as const).filter((d) =>
    items.some((t) => t.difficulty === d),
  );
  const topics = uniq(items.flatMap((t) => t.topics));
  const shown = items.filter(
    (t) =>
      (difficulty === "any" || t.difficulty === difficulty) &&
      (topic === "all" || t.topics.includes(topic)),
  );
  return (
    <Wrap>
      <FilterBar>
        {levels.length > 1 && (
          <Toggle
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              ["any", "Any difficulty"],
              ...levels.map((l): [string, string] => [l, LEVELS[l]!]),
            ]}
          />
        )}
        {topics.length > 1 && (
          <Toggle
            label="Topic"
            value={topic}
            onChange={setTopic}
            options={opts("All topics", topics)}
          />
        )}
      </FilterBar>
      {shown.length === 0 ? (
        <NoMatch />
      ) : (
        <Grid>
          {shown.map((t) => (
            <TutorialCardView key={t.slug} t={t} />
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

const HUB_CARDS = [
  {
    kind: "course" as const,
    title: "AI Courses",
    text: "Structured, hands-on courses, from your first prompt to building with models.",
    Icon: GraduationCap,
  },
  {
    kind: "book" as const,
    title: "AI Books",
    text: "Books that explain how AI works and how to put it to use.",
    Icon: BookOpen,
  },
  {
    kind: "tutorial" as const,
    title: "AI Tutorials",
    text: "Short, practical walkthroughs for getting a specific job done with AI.",
    Icon: PlayCircle,
  },
];

/** /learn: the three sections, each with its count and up to three featured entries. */
export function LearnHub({
  courses,
  books,
  tutorials,
}: {
  courses: CourseCard[];
  books: CourseCard[];
  tutorials: TutorialCard[];
}) {
  const counts = { course: courses.length, book: books.length, tutorial: tutorials.length };
  const top = <T extends { featured: boolean }>(xs: T[]) =>
    [...xs.filter((x) => x.featured), ...xs.filter((x) => !x.featured)].slice(0, 3);
  return (
    <Wrap>
      <div className="grid gap-5 md:grid-cols-3 lg:gap-6">
        {HUB_CARDS.map(({ kind, title, text, Icon }) => (
          <a
            key={kind}
            href={LEARN_PATH[kind]}
            className="group flex flex-col rounded-3xl border p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ background: "var(--surface)", borderColor: "var(--surface-border)" }}
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-soft">
              <Icon aria-hidden className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-2xl font-bold group-hover:text-primary">{title}</h2>
            <p className="mt-2 flex-1 text-sm text-foreground/75">{text}</p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-primary">
              {counts[kind] > 0
                ? `Browse ${counts[kind]} ${counts[kind] === 1 ? title.slice(3, -1).toLowerCase() : title.slice(3).toLowerCase()}`
                : "Coming soon"}
              <ArrowUpRight
                aria-hidden
                className="h-4 w-4 rotate-45 transition group-hover:translate-x-0.5"
              />
            </span>
          </a>
        ))}
      </div>
      {courses.length > 0 && (
        <HubRow title="Featured courses" href={LEARN_PATH.course} label="All AI courses">
          <Grid>
            {top(courses).map((c) => (
              <CourseCardView key={c.slug} c={c} />
            ))}
          </Grid>
        </HubRow>
      )}
      {books.length > 0 && (
        <HubRow title="Featured books" href={LEARN_PATH.book} label="All AI books">
          <Grid narrow>
            {top(books).map((b) => (
              <BookCardView key={b.slug} b={b} />
            ))}
          </Grid>
        </HubRow>
      )}
      {tutorials.length > 0 && (
        <HubRow title="Featured tutorials" href={LEARN_PATH.tutorial} label="All AI tutorials">
          <Grid>
            {top(tutorials).map((t) => (
              <TutorialCardView key={t.slug} t={t} />
            ))}
          </Grid>
        </HubRow>
      )}
    </Wrap>
  );
}

function HubRow({
  title,
  href,
  label,
  children,
}: {
  title: string;
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-3xl font-bold">{title}</h2>
        <a href={href} className="text-sm font-bold text-primary hover:underline">
          {label} →
        </a>
      </div>
      {children}
    </section>
  );
}

/** "More …" links at the bottom of a Learning Hub detail page. */
export function RelatedResources({
  title,
  items,
}: {
  title: string;
  items: { kind: LearnKind; slug: string; title: string; meta: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="mt-12 border-t border-border pt-8">
      <h2 className="text-xl font-bold">{title}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {items.map((r) => (
          <li key={r.slug}>
            <a
              href={learnPathOf(r.kind, r.slug)}
              className="block h-full rounded-2xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-soft"
            >
              <span className="font-semibold">{r.title}</span>
              {r.meta && <span className="mt-1 block text-xs text-muted-foreground">{r.meta}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ gadgets

export function GadgetsList({ items }: { items: GadgetCard[] }) {
  const [type, setType] = useState("all");
  const types = useMemo(() => [...new Set(items.map((g) => g.type))], [items]);
  const shown = items.filter((g) => type === "all" || g.type === type);
  return (
    <Wrap>
      {types.length > 1 && (
        <Toggle
          label="Gadget type"
          value={type}
          onChange={setType}
          options={[
            ["all", "All"],
            ...types.map((t): [string, string] => [t, GADGET_TYPES[t] ?? t]),
          ]}
        />
      )}
      {shown.length === 0 ? (
        <NoMatch />
      ) : (
        <Grid>
          {shown.map((g) => (
            <article key={g.slug} className="tool-card overflow-hidden p-0">
              <div className="relative">
                <Img image={g.image} className="aspect-[4/3] w-full" />
                <span className="absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-0.5 text-xs font-bold text-primary">
                  {GADGET_TYPES[g.type] ?? g.type}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h3 className="text-base font-bold leading-snug">
                  <a href={`/gadgets/${g.slug}`} className="hover:text-primary">
                    {g.title}
                  </a>
                </h3>
                {g.features.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-sm text-foreground/75">
                    {g.features.slice(0, 2).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex items-baseline gap-2 pt-2">
                  {g.price && <span className="font-bold">{g.price}</span>}
                  {g.retailer && (
                    <span className="text-xs text-muted-foreground">at {g.retailer}</span>
                  )}
                </div>
                {g.url && (
                  <AffiliateButton href={g.url}>
                    {g.retailer ? `Check price on ${g.retailer}` : "Check price"}
                  </AffiliateButton>
                )}
                <a
                  href={`/gadgets/${g.slug}`}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  {g.otherRetailers.length ? "Compare retailers" : "Read our take"}
                </a>
              </div>
            </article>
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

// ------------------------------------------------------------------ guest articles + blog

export function GuestList({ items }: { items: GuestCard[] }) {
  const [topic, setTopic] = useState("all");
  const topics = useMemo(
    () => [...new Set(items.map((a) => a.topic).filter((t): t is string => !!t))],
    [items],
  );
  const shown = items.filter((a) => topic === "all" || a.topic === topic);
  return (
    <Wrap>
      {topics.length > 1 && (
        <Toggle
          label="Topics"
          value={topic}
          onChange={setTopic}
          options={[["all", "All topics"], ...topics.map((t): [string, string] => [t, t])]}
        />
      )}
      {shown.length === 0 ? (
        <NoMatch />
      ) : (
        <Grid>
          {shown.map((a) => (
            <article key={a.slug} className="tool-card overflow-hidden p-0">
              <div className="relative">
                <Img image={a.image} className="aspect-[16/9] w-full" />
                <span className="absolute left-3 top-3">
                  <SponsoredBadge label={a.sponsorLabel} />
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                {a.topic && (
                  <span className="text-xs font-bold uppercase tracking-wide text-primary">
                    {a.topic}
                  </span>
                )}
                <h3 className="text-base font-bold leading-snug">
                  <a href={`/guest-articles/${a.slug}`} className="hover:text-primary">
                    {a.title}
                  </a>
                </h3>
                {a.excerpt && (
                  <p className="line-clamp-2 text-sm text-foreground/75">{a.excerpt}</p>
                )}
                <p className="mt-auto pt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{a.contributor}</span>
                  <br />
                  {a.sponsorLabel} by {a.sponsor} · {fmt(a.publishedAt)}
                </p>
              </div>
            </article>
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

export function BlogList({ items }: { items: PostCard[] }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("all");
  const tags = useMemo(() => [...new Set(items.flatMap((p) => p.tags))].slice(0, 12), [items]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (p) =>
      (tag === "all" || p.tags.includes(tag)) &&
      (!needle || `${p.title} ${p.excerpt ?? ""}`.toLowerCase().includes(needle)),
  );
  const [lead, ...rest] = shown;
  return (
    <Wrap>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tags.length > 1 ? (
          <Toggle
            label="Topics"
            value={tag}
            onChange={setTag}
            options={[["all", "All"], ...tags.map((t): [string, string] => [t, t])]}
          />
        ) : (
          <span />
        )}
        <label className="w-full max-w-xs text-sm">
          <span className="sr-only">Search the blog</span>
          <input
            type="search"
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search articles…"
            className="w-full rounded-full border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
          />
        </label>
      </div>
      {!lead && <NoMatch />}
      {lead && (
        <article className="grid gap-7 rounded-3xl border border-border bg-card p-6 shadow-card md:grid-cols-2">
          <Img image={lead.image} className="aspect-[16/9] w-full rounded-2xl" eager />
          <div className="flex flex-col justify-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wide text-primary">Latest</span>
            <h2 className="text-3xl font-bold">
              <a href={`/blog/${lead.slug}`} className="hover:text-primary">
                {lead.title}
              </a>
            </h2>
            {lead.excerpt && <p className="text-foreground/80">{lead.excerpt}</p>}
            <p className="text-sm text-muted-foreground">
              {[
                lead.author ?? "TryAITools team",
                fmt(lead.publishedAt),
                `${lead.minutes} min read`,
              ].join(" · ")}
            </p>
          </div>
        </article>
      )}
      {rest.length > 0 && (
        <Grid>
          {rest.map((p) => (
            <article key={p.slug} className="flex flex-col gap-2">
              <Img image={p.image} className="aspect-[16/9] w-full rounded-2xl" />
              {p.tags[0] && (
                <span className="text-xs font-bold uppercase tracking-wide text-primary">
                  {p.tags[0]}
                </span>
              )}
              <h3 className="text-base font-bold leading-snug">
                <a href={`/blog/${p.slug}`} className="hover:text-primary">
                  {p.title}
                </a>
              </h3>
              <p className="text-xs text-muted-foreground">
                {fmt(p.publishedAt)} · {p.minutes} min read
              </p>
            </article>
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

// ------------------------------------------------------------------ detail page

export function ContentDetailPage({
  section,
  title,
  badges,
  meta,
  lead,
  actions,
  image,
  notice,
  body,
  sponsored,
  aside,
  parents = [],
  related,
}: {
  section: { label: string; href: string };
  /** breadcrumb levels between the site and `section` (e.g. the Learning Hub) */
  parents?: { label: string; href: string }[];
  related?: ReactNode;
  title: string;
  badges?: ReactNode;
  meta?: ReactNode;
  lead?: string | null;
  actions?: ReactNode;
  image: PublicImage | null;
  notice?: ReactNode;
  body: string;
  sponsored: boolean;
  aside?: ReactNode;
}) {
  return (
    <Page>
      <section className="bg-hero pb-10 pt-14">
        <div className="mx-auto max-w-5xl page-x">
          <Crumbs trail={[...parents, section, { label: title }]} />
          {badges && <div className="mt-5 flex flex-wrap items-center gap-2">{badges}</div>}
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">{title}</h1>
          {meta && <div className="mt-3 text-sm text-muted-foreground">{meta}</div>}
          {lead && <p className="mt-4 max-w-3xl text-lg text-foreground/80">{lead}</p>}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
          {notice && (
            <p className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{notice}</span>
            </p>
          )}
        </div>
      </section>
      <div className="mx-auto max-w-5xl pb-20 pt-8 page-x">
        {image && (
          <Img
            image={image}
            className="mb-8 max-h-[28rem] w-full rounded-3xl border border-border"
            eager
          />
        )}
        {aside}
        {body.trim() && (
          <article className="max-w-3xl">
            <MarkdownView source={body} sponsored={sponsored} />
          </article>
        )}
        {related}
        <a
          href={section.href}
          className="mt-10 inline-flex text-sm font-semibold text-primary hover:underline"
        >
          ← All {section.label}
        </a>
      </div>
    </Page>
  );
}

export const Minutes = ({ n }: { n: number }) => (
  <span className="inline-flex items-center gap-1">
    <Clock aria-hidden className="h-3.5 w-3.5" /> {n} min read
  </span>
);
export { fmt as formatDate };

export function ContentNotFound({
  what,
  href,
  back,
}: {
  what: string;
  href: string;
  back: string;
}) {
  return (
    <Page>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">{what} not found</h1>
        <p className="mt-3 text-muted-foreground">
          It may have been moved or is no longer available.
        </p>
        <a
          href={href}
          className="mt-6 inline-flex rounded-full bg-gradient-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-soft"
        >
          {back}
        </a>
      </div>
    </Page>
  );
}

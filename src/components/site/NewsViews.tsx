// Public views of AI News: cards, the listing (landing and category pages) and the article page. Every summary is
// labelled as AI-generated and every article links to the original publisher. Links are plain <a> (full page loads), like
// the rest of the public site, because pages are served as static files by the gate where possible.
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Flame,
  Info,
  Newspaper,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  type NewsCard,
  type NewsCategory,
  type NewsDetail,
} from "@/lib/news/model";

const dateOf = (n: NewsCard) => formatDate(n.sourcePublishedAt ?? n.publishedAt);

/**
 * A card's date: the publisher's original publication date, or "Added <date>" when the feed gave none (so the date
 * TryAITools collected it is never passed off as the publication date). The relative age ("3 hours ago", "Yesterday")
 * is added in the browser only: pages are pre-built, so an age rendered on the server would go stale.
 */
export function NewsDate({ n }: { n: NewsCard }) {
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
      {age && <span className="font-semibold text-primary"> · {age}</span>}
    </time>
  );
}

/**
 * An article image in a fixed-ratio frame. The branded placeholder (purple gradient + news icon) is always drawn first,
 * and the image covers it once loaded. If there is no image, or it fails (blocked, 404, offline), the image is removed
 * and the placeholder stays: never a broken-image icon or an empty box. Decorative (alt=""): the headline says it all.
 */
export function NewsImage({
  src,
  className,
  eager = false,
  large = false,
}: {
  src: string | null;
  className: string;
  eager?: boolean;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image that already failed before hydration never fires React's onError: check once on mount.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-secondary via-secondary to-primary/25 ${className}`}
    >
      <div aria-hidden className="absolute inset-0 grid place-items-center">
        <span
          className={`grid place-items-center rounded-2xl bg-background/70 text-primary/70 shadow-card ring-1 ring-primary/10 ${
            large ? "h-16 w-16" : "h-12 w-12"
          }`}
        >
          <Newspaper className={large ? "h-8 w-8" : "h-6 w-6"} />
        </span>
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
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

/**
 * A news card. `lead` (the newest story) and `wide` (the last card when it would otherwise sit alone in its row) span
 * both grid columns and lay out image and text side by side from md up, so the grid never ends in a half-empty row.
 */
export function NewsCardView({
  n,
  lead = false,
  wide = false,
}: {
  n: NewsCard;
  lead?: boolean;
  wide?: boolean;
}) {
  const across = lead || wide;
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 ${
        across ? "sm:col-span-2 md:grid md:grid-cols-2" : ""
      }`}
    >
      <NewsImage
        src={n.imageUrl}
        className={
          across
            ? "aspect-[16/9] w-full md:aspect-auto md:h-full md:min-h-[16rem]"
            : "aspect-[16/9] w-full"
        }
        eager={lead}
      />
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a
            href={newsCategoryPath(n.category)}
            className="font-bold uppercase tracking-wide text-primary hover:underline"
          >
            {categoryLabel(n.category)}
          </a>
          {n.featured && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">
              Editor&apos;s pick
            </span>
          )}
        </div>
        <h3
          className={`font-bold leading-snug ${lead ? "text-2xl" : wide ? "text-lg" : "text-base"}`}
        >
          <a href={newsArticlePath(n.slug)} className="hover:text-primary">
            {n.title}
          </a>
        </h3>
        <p className="text-sm text-foreground/75">{n.description}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{n.sourceName}</span> ·{" "}
            <NewsDate n={n} />
          </span>
          <a
            href={newsArticlePath(n.slug)}
            className="font-semibold text-primary hover:underline"
            aria-label={`Read more: ${n.title}`}
          >
            Read more →
          </a>
        </div>
      </div>
    </article>
  );
}

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
    "inline-flex items-center gap-1 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:border-primary/40 hover:text-primary";
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-between gap-3">
      {page > 1 ? (
        <a href={href(page - 1)} rel="prev" className={cls}>
          <ChevronLeft aria-hidden className="h-4 w-4" /> Newer
        </a>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">Page {page}</span>
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

export const AI_NOTICE =
  "Summaries are written by AI (Google Gemini) from the publisher's own feed and link to the original article. Always check the source for full details.";

export function NewsListing({
  category,
  items,
  trending,
  page,
  hasMore,
  q,
}: {
  category: NewsCategory | null;
  items: NewsCard[];
  trending: NewsCard[];
  page: number;
  hasMore: boolean;
  q: string;
}) {
  const base = category ? newsCategoryPath(category) : NEWS_PATH;
  const title = category ? `${categoryLabel(category)} — AI News` : "AI News";
  const showLead = !q && page === 1 && items.length > 2;
  const [lead, ...rest] = showLead ? items : [null, ...items];
  const cards = rest.filter((n): n is NewsCard => !!n);
  return (
    <Page>
      <section className="bg-hero pb-10 pt-14">
        <div className="page-container">
          <Crumbs
            trail={
              category
                ? [{ label: "AI News", href: NEWS_PATH }, { label: categoryLabel(category) }]
                : [{ label: "AI News" }]
            }
          />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 flex-[1_1_480px]">
              <h1 className="text-4xl font-bold sm:text-5xl">{title}</h1>
              <p className="mt-3 max-w-2xl text-base text-foreground/75 sm:text-lg">
                {category
                  ? `The latest ${categoryLabel(category).toLowerCase()} from official AI company blogs and trusted outlets, summarised.`
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
      <div className="page-container grid gap-10 pb-20 pt-10 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="latest-heading" className="min-w-0">
          <header className="mb-6">
            <h2 id="latest-heading" className="text-2xl font-bold sm:text-3xl">
              {q
                ? `Results for “${q}”`
                : `${category ? `Latest ${categoryLabel(category)}` : "Latest AI News"}${
                    page > 1 ? ` — page ${page}` : ""
                  }`}
            </h2>
            {!q && (
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                The latest developments, launches and research in artificial intelligence.
              </p>
            )}
          </header>
          {items.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-primary/25 bg-secondary px-6 py-14 text-center">
              <h3 className="text-xl font-bold">{q ? "No matching news" : "No news here yet"}</h3>
              <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                {q
                  ? "Try a shorter search, or browse a category."
                  : "New stories are collected every few hours. Check back soon."}
              </p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              {lead && <NewsCardView n={lead} lead />}
              {cards.map((n, i) => (
                <NewsCardView
                  key={n.slug}
                  n={n}
                  wide={cards.length % 2 === 1 && i === cards.length - 1}
                />
              ))}
            </div>
          )}
          <Pager base={base} page={page} hasMore={hasMore} q={q} />
        </section>
        {/* Sticky on large screens so Trending stays in view beside a long article list instead of leaving an empty
            column. */}
        <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
          {trending.length > 0 && (
            <section
              aria-labelledby="trending-heading"
              className="rounded-3xl border border-border bg-card p-5 shadow-card"
            >
              <h2 id="trending-heading" className="flex items-center gap-2 text-lg font-bold">
                <Flame aria-hidden className="h-5 w-5 text-primary" /> Trending
              </h2>
              <ol className="mt-4 space-y-4">
                {trending.map((n, i) => (
                  <li key={n.slug} className="flex gap-3">
                    <span className="text-2xl font-extrabold leading-none text-primary/40">
                      {i + 1}
                    </span>
                    <div>
                      <a
                        href={newsArticlePath(n.slug)}
                        className="text-sm font-semibold leading-snug hover:text-primary"
                      >
                        {n.title}
                      </a>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {n.sourceName} · {dateOf(n)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-lg font-bold">Categories</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {NEWS_CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <a href={newsCategoryPath(c.slug)} className="font-semibold hover:text-primary">
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </Page>
  );
}

export function NewsArticleView({ a, related }: { a: NewsDetail; related: NewsCard[] }) {
  const paragraphs = a.summary.split(/\n\s*\n/).filter(Boolean);
  return (
    <Page>
      <section className="bg-hero pb-10 pt-14">
        <div className="mx-auto max-w-4xl page-x">
          <Crumbs
            trail={[
              { label: "AI News", href: NEWS_PATH },
              { label: categoryLabel(a.category), href: newsCategoryPath(a.category) },
              { label: a.title },
            ]}
          />
          <a
            href={newsCategoryPath(a.category)}
            className="mt-5 inline-block text-xs font-bold uppercase tracking-wide text-primary hover:underline"
          >
            {categoryLabel(a.category)}
          </a>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{a.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Source: <span className="font-semibold text-foreground">{a.sourceName}</span>
            {a.sourcePublishedAt ? ` · Published ${formatDate(a.sourcePublishedAt)}` : ""} ·
            Summarised {formatDate(a.publishedAt > a.collectedAt ? a.publishedAt : a.collectedAt)}
          </p>
          <a
            href={a.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
          >
            Read the original on {a.sourceName} <ArrowUpRight aria-hidden className="h-4 w-4" />
          </a>
        </div>
      </section>
      <div className="mx-auto max-w-4xl pb-20 pt-8 page-x">
        <div
          role="note"
          className="mb-6 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm"
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
        <NewsImage
          src={a.imageUrl}
          className="mb-8 aspect-[16/9] max-h-[26rem] w-full rounded-3xl border border-border"
          eager
          large
        />
        <article className="max-w-3xl space-y-4 text-lg leading-relaxed text-foreground/90">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </article>
        {a.takeaways.length > 0 && (
          <section
            aria-labelledby="takeaways"
            className="mt-8 max-w-3xl rounded-3xl border border-border bg-card p-6 shadow-card"
          >
            <h2 id="takeaways" className="text-lg font-bold">
              Key takeaways
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
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
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary"
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
          <section aria-labelledby="related-news" className="mt-12">
            <h2 id="related-news" className="mb-5 text-xl font-bold">
              Related news
            </h2>
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
          className="mt-6 inline-flex rounded-full bg-gradient-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-soft"
        >
          Read the latest AI news
        </a>
      </div>
    </Page>
  );
}

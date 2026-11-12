import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryIcon } from "@/components/site/CategoryIcon";
import { Page } from "@/components/site/Layout";
import { ToolCard } from "@/components/site/ToolCard";
import { ToolSearchInput } from "@/components/site/ToolSearchInput";
import { pageHead } from "@/lib/seo";
import { absoluteUrl, SITE_NAME } from "@/lib/site";
import { fetchCategory } from "@/lib/catalog/api";
import { filterTools, MAX_QUERY, normalizeToolsQuery } from "@/lib/catalog/views";
import {
  isPricingFilter,
  matchesPricing,
  PRICING_LABELS,
  PRICING_MODELS,
  pricingCounts,
  type PricingFilter,
} from "@/lib/pricing";
import { dropAI, shortName } from "@/lib/tool-utils";

/** JSON for a <script type="application/ld+json">: "<" escaped so no value can close the script element. */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
/** "Best AI Writing Tools: ..." fits Google's ~60 characters; the site name is added only when it still fits. */
const withSite = (t: string) => (t.length + SITE_NAME.length + 3 <= 60 ? `${t} | ${SITE_NAME}` : t);

type CategorySearch = {
  sub?: string | undefined;
  q?: string | undefined;
  pricing?: PricingFilter | undefined;
};

export const Route = createFileRoute("/categories/$slug")({
  // ?sub=, ?q= and ?pricing= only change what the browser shows; the pre-built page and its canonical URL stay the same
  // (no indexable URL per filter, nothing in the sitemap).
  validateSearch: (search: Record<string, unknown>): CategorySearch => ({
    ...(typeof search["sub"] === "string" ? { sub: search["sub"] } : {}),
    ...(typeof search["q"] === "string" && search["q"]
      ? { q: search["q"].slice(0, MAX_QUERY) }
      : {}),
    ...(isPricingFilter(search["pricing"]) && search["pricing"] !== "all"
      ? { pricing: search["pricing"] }
      : {}),
  }),
  loader: ({ params }) => fetchCategory({ data: params.slug }),
  // The page is pre-built HTML; its data never needs refetching in the browser (that would call the Worker).
  staleTime: Infinity,
  head: ({ loaderData, params }) => {
    const n = loaderData?.category.name ?? "Category";
    const landing = loaderData?.landing;
    const path = `/categories/${params.slug}`;
    const base = pageHead({
      title: landing?.seoTitle ? withSite(landing.seoTitle) : `Best ${n} | ${SITE_NAME}`,
      description:
        landing?.seoDescription ?? `Discover the best ${n} — compare and visit top picks.`,
      path,
      // a category that does not exist renders the not-found component: noindex, and no canonical; an existing category
      // an editor set to noindex keeps its canonical but is noindex (and is left out of the sitemap)
      ...(loaderData
        ? loaderData.indexable === false
          ? { noindex: true }
          : {}
        : { noindex: true, canonical: false }),
    });
    if (!loaderData) return base;
    const listed = (
      loaderData.topPicks?.length ? loaderData.topPicks : (loaderData.tools ?? [])
    ).slice(0, 10);
    const graph: unknown[] = [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
          {
            "@type": "ListItem",
            position: 2,
            name: "Categories",
            item: absoluteUrl("/categories"),
          },
          { "@type": "ListItem", position: 3, name: dropAI(n), item: absoluteUrl(path) },
        ],
      },
      {
        "@type": "CollectionPage",
        name: n,
        url: absoluteUrl(path),
        ...(landing?.seoDescription ? { description: landing.seoDescription } : {}),
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: listed.length,
          itemListElement: listed.map((t, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: t.name,
            url: absoluteUrl(`/tools/${t.slug}`),
          })),
        },
      },
    ];
    if (landing?.faqs.length)
      graph.push({
        "@type": "FAQPage",
        mainEntity: landing.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      });
    return {
      ...base,
      scripts: [
        {
          type: "application/ld+json",
          children: jsonLd({ "@context": "https://schema.org", "@graph": graph }),
        },
      ],
    };
  },
  notFoundComponent: () => (
    <Page>
      <div className="py-32 text-center">
        <h1 className="text-3xl font-bold">Category not found</h1>
        <a href="/categories" className="mt-4 inline-block text-primary">
          Browse categories
        </a>
      </div>
    </Page>
  ),
  component: CategoryPage,
});

function CategoryPage() {
  const { category, tools: all, categories, topPicks, totalTools, landing } = Route.useLoaderData();
  const { sub: selected, q: urlQ, pricing: urlPricing } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Applied after mount: the pre-built HTML is the unfiltered list, so the first browser render must match it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const sub = mounted && selected && category.subcategories.includes(selected) ? selected : "";
  // Search inside this category (and subcategory): the page already holds all of its tools, so filtering happens in
  // the browser with the same matching rule as /tools (name, use case, website), with no request to the Worker.
  const [q, setQ] = useState("");
  useEffect(() => setQ(urlQ ?? ""), [urlQ]);
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(
      () =>
        void navigate({
          search: (s: CategorySearch) => ({ ...s, q: q.trim() || undefined }),
          replace: true,
        }),
      250,
    );
    return () => clearTimeout(t);
  }, [q, navigate]);
  const query = mounted ? normalizeToolsQuery({ q }).q : "";
  const pricing: PricingFilter = mounted && urlPricing ? urlPricing : "all";
  const matching = filterTools(all, sub, query); // before the pricing filter: its counts follow search + subcategory
  const counts = pricingCounts(matching.map((t) => t.pricing));
  const list =
    pricing === "all" ? matching : matching.filter((t) => matchesPricing(t.pricing, pricing));
  const priced = matching.some((t) => t.pricing);
  const filtering = !!(sub || query || pricing !== "all");
  // "AI Grammar & Editing Tools" -> "Grammar & Editing" (as the category is shortened), for "Search Grammar & Editing tools"
  const scope = shortName(sub || category.name);
  // distinct tools (a tool listed on several category pages counts once)
  const total = totalTools ?? categories.reduce((s, c) => s + c.toolCount, 0);
  return (
    <Page>
      {/* Phones and tablets keep the full-width header band; from lg the page gets the category sidebar and the
          heading becomes a box beside it. One heading block either way (one h1). */}
      <div className="page-container lg:flex lg:items-start lg:gap-8 lg:pt-6">
        <aside
          aria-label="Categories"
          className="hidden lg:sticky lg:top-24 lg:block lg:w-64 lg:shrink-0 lg:rounded-3xl lg:border lg:border-border lg:bg-secondary lg:p-3"
        >
          <p className="px-3 pb-2 pt-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Categories
          </p>
          <nav className="flex flex-col gap-0.5">
            {[{ name: "All Categories", slug: "", toolCount: total }, ...categories].map((c) => {
              const current = c.slug === category.slug;
              return (
                <a
                  key={c.slug || "all"}
                  href={c.slug ? `/categories/${c.slug}` : "/categories"}
                  aria-current={current ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                    current
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/80 hover:bg-accent hover:text-primary"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {c.slug && <CategoryIcon slug={c.slug} className="h-4 w-4 opacity-80" />}
                    <span className="truncate">{c.slug ? dropAI(c.name) : c.name}</span>
                  </span>
                  <span
                    className={`text-xs ${current ? "text-primary-foreground/85" : "text-muted-foreground"}`}
                  >
                    {c.toolCount.toLocaleString()}
                  </span>
                </a>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <section className="-mx-4 bg-hero px-4 pb-12 pt-14 sm:-mx-6 sm:px-6 lg:mx-0 lg:mt-0 lg:rounded-3xl lg:border lg:border-primary/10 lg:bg-gradient-to-b lg:from-[#F6F5FF] lg:to-[#ECEAFF] lg:p-7">
            <a href="/categories" className="text-sm font-medium text-primary lg:hidden">
              ← All categories
            </a>
            <nav aria-label="Breadcrumb" className="hidden lg:block">
              <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                <li>
                  <a href="/" className="hover:text-primary">
                    AI Tools
                  </a>
                </li>
                <li aria-hidden>
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
                <li>
                  <a href="/categories" className="hover:text-primary">
                    Categories
                  </a>
                </li>
                <li aria-hidden>
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
                {sub ? (
                  <>
                    <li>
                      <a href={`/categories/${category.slug}`} className="hover:text-primary">
                        {dropAI(category.name)}
                      </a>
                    </li>
                    <li aria-hidden>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </li>
                    <li aria-current="page" className="font-semibold text-foreground">
                      {dropAI(sub)}
                    </li>
                  </>
                ) : (
                  <li aria-current="page" className="font-semibold text-foreground">
                    {dropAI(category.name)}
                  </li>
                )}
              </ol>
            </nav>
            <h1 className="mt-3 flex items-center gap-3 text-4xl font-bold">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-soft">
                <CategoryIcon slug={category.slug} className="h-5 w-5" />
              </span>
              {category.name}
            </h1>
            <p className="mt-2 text-foreground/70">{all.length} tools in this category</p>
            {landing?.intro && (
              <div className="mt-4 max-w-3xl space-y-3 text-foreground/80">
                {landing.intro.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            )}
            <ToolSearchInput
              value={q}
              onChange={(v) => {
                typed.current = true;
                setQ(v);
              }}
              label={`Search ${scope} tools`}
              placeholder={`Search ${scope} tools…`}
            />
          </section>
          {!filtering && topPicks && topPicks.length > 0 && (
            <section className="pt-8" aria-labelledby="top-picks">
              <h2 id="top-picks" className="text-2xl font-bold">
                Top picks
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reviewed against each tool&apos;s official website.{" "}
                <a href="/how-we-review" className="font-semibold text-primary hover:underline">
                  How we review
                </a>
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {topPicks.map((t) => (
                  <ToolCard key={t.slug} tool={t} />
                ))}
              </div>
            </section>
          )}
          <div className="pt-8">
            <h2 className="filter-heading">Subcategories</h2>
            <div role="group" aria-label="Filter by subcategory" className="flex flex-wrap gap-2">
              {["", ...category.subcategories].map((s) => (
                <Button
                  key={s || "all"}
                  variant="outline"
                  aria-pressed={sub === s}
                  onClick={() =>
                    navigate({ search: (p: CategorySearch) => ({ ...p, sub: s || undefined }) })
                  }
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                    sub === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  {s ? dropAI(s) : "All"}
                </Button>
              ))}
            </div>
            <div role="group" aria-label="Filter by pricing" className="filter-section">
              <h2 className="filter-heading">Pricing</h2>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", ...PRICING_MODELS] as PricingFilter[]).map((p) => {
                  const on = pricing === p;
                  const n = counts[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && p !== "all" && n === 0}
                      onClick={() =>
                        navigate({
                          search: (s: CategorySearch) => ({
                            ...s,
                            pricing: p === "all" ? undefined : p,
                          }),
                          replace: true,
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground/80 hover:border-primary/40"
                      }`}
                    >
                      {p === "all" ? "All" : PRICING_LABELS[p]}
                      <span className={on ? "text-primary-foreground/80" : "text-muted-foreground"}>
                        {n}
                      </span>
                    </button>
                  );
                })}
                {mounted && !priced && (
                  <span className="text-xs text-muted-foreground">
                    Pricing isn&apos;t recorded for these tools yet.
                  </span>
                )}
              </div>
            </div>
            <p className="sr-only" aria-live="polite">
              {filtering ? `${list.length} matching tools` : ""}
            </p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3 2xl:grid-cols-4">
              {list.map((t) => (
                <ToolCard key={t.slug} tool={t} showCategory={false} />
              ))}
            </div>
            {list.length === 0 && (
              <div className="py-20 text-center text-muted-foreground">
                {pricing !== "all" && matching.length > 0 ? (
                  <>
                    <p>No {PRICING_LABELS[pricing]} tools here.</p>
                    <button
                      type="button"
                      className="mt-3 text-sm font-semibold text-primary hover:underline"
                      onClick={() =>
                        navigate({
                          search: (s: CategorySearch) => ({ ...s, pricing: undefined }),
                          replace: true,
                        })
                      }
                    >
                      Show all pricing
                    </button>
                  </>
                ) : query ? (
                  <>
                    <p>
                      No {scope} tools match &ldquo;{q.trim()}&rdquo;.
                    </p>
                    <button
                      type="button"
                      className="mt-3 text-sm font-semibold text-primary hover:underline"
                      onClick={() => {
                        typed.current = true;
                        setQ("");
                      }}
                    >
                      Clear search
                    </button>
                  </>
                ) : (
                  <p>No {scope} tools listed yet.</p>
                )}
              </div>
            )}
          </div>
          {landing && landing.faqs.length > 0 && (
            <section className="pb-12 pt-10" aria-labelledby="faq-h">
              <h2 id="faq-h" className="text-2xl font-bold">
                Frequently asked questions
              </h2>
              <div className="mt-4 divide-y divide-border rounded-3xl border border-border bg-card">
                {landing.faqs.map((f) => (
                  <details key={f.q} className="group px-5 py-4">
                    <summary className="cursor-pointer list-none font-semibold">{f.q}</summary>
                    <p className="mt-2 text-foreground/80">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </Page>
  );
}

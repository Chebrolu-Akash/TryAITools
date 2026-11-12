import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ToolSearchInput } from "@/components/site/ToolSearchInput";
import { Page } from "@/components/site/Layout";
import { ToolCard } from "@/components/site/ToolCard";
import { fetchToolsPage } from "@/lib/catalog/api";
import type { PublicTool } from "@/lib/catalog/model";
import { searchTools } from "@/lib/catalog/search-client";
import type { ToolsPageData } from "@/lib/catalog/views";
import { isPricingFilter, PRICING_LABELS, PRICING_MODELS, type PricingFilter } from "@/lib/pricing";
import { pageHead } from "@/lib/seo";
import { absoluteUrl, countLabel } from "@/lib/site";
import { shortName } from "@/lib/tool-utils";

type ToolsSearch = {
  q?: string | undefined;
  category?: string | undefined;
  pricing?: PricingFilter | undefined;
};

// /tools is pre-built with the default first page (48 tools). Search, category and pricing filters and "Load more" query
// /api/search from the browser, so the HTML never depends on the query string and the page stays static.
export const Route = createFileRoute("/tools/")({
  validateSearch: (s: Record<string, unknown>): ToolsSearch => ({
    ...(typeof s["q"] === "string" && s["q"] ? { q: s["q"].slice(0, 100) } : {}),
    ...(typeof s["category"] === "string" && s["category"]
      ? { category: s["category"].slice(0, 80) }
      : {}),
    ...(isPricingFilter(s["pricing"]) && s["pricing"] !== "all" ? { pricing: s["pricing"] } : {}),
  }),
  loader: () => fetchToolsPage({ data: { q: "", category: "", pricing: "all", tag: "", page: 1 } }),
  staleTime: Infinity, // never refetch in the browser (that would call the Worker's page renderer)
  head: ({ loaderData }) => {
    const n = loaderData ? countLabel(loaderData.total) : "";
    return {
      ...pageHead({
        title: "All AI Tools — Search & Filter | TryAITools",
        description: `Search and filter ${n ? `${n} ` : ""}AI tools by category, pricing model and use case, from writing and images to coding, marketing and education.`,
        path: "/tools",
      }),
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
              {
                "@type": "ListItem",
                position: 2,
                name: "All AI Tools",
                item: absoluteUrl("/tools"),
              },
            ],
          }),
        },
      ],
    };
  },
  component: ToolsPage,
});

function ToolsPage() {
  const search = Route.useSearch();
  const initial = Route.useLoaderData();
  const navigate = useNavigate({ from: "/tools/" });
  const [result, setResult] = useState<ToolsPageData>(initial);
  const [items, setItems] = useState<PublicTool[]>(initial.items);
  const [q, setQ] = useState(search.q ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Fetch the first page for the query in the URL whenever it differs from what is shown (after mount, so the first
  // browser render matches the pre-built HTML).
  const wantQ = (search.q ?? "").trim().toLowerCase();
  const wantCategory = search.category ?? "";
  const wantPricing: PricingFilter = search.pricing ?? "all";
  useEffect(() => {
    if (
      result.q === wantQ &&
      result.category === wantCategory &&
      (result.pricing ?? "all") === wantPricing &&
      result.page === 1
    )
      return;
    const ctrl = new AbortController();
    setBusy(true);
    setError(false);
    searchTools(
      { q: wantQ, category: wantCategory, pricing: wantPricing, tag: "", page: 1 },
      ctrl.signal,
    )
      .then((r) => {
        setResult(r);
        setItems(r.items);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setError(true);
      })
      .finally(() => setBusy(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the requested query changes
  }, [wantQ, wantCategory, wantPricing]);
  useEffect(() => setQ(search.q ?? ""), [search.q]);

  // Typing updates the URL (and so the search) after a short pause.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => {
      const next = q.trim();
      void navigate({
        search: (s: ToolsSearch) => ({ ...s, q: next || undefined }),
        replace: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, navigate]);

  async function loadMore() {
    setBusy(true);
    setError(false);
    try {
      const next = await searchTools({
        q: result.q,
        category: result.category,
        pricing: result.pricing ?? "all",
        tag: "",
        page: result.page + 1,
      });
      setItems((prev) => [...prev, ...next.items]);
      setResult(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <section className="bg-hero pb-12 pt-14">
        <div className="page-container">
          <h1 className="text-4xl font-bold">All AI Tools</h1>
          <p className="mt-2 text-foreground/70" aria-live="polite">
            {result.total.toLocaleString()} tools found
          </p>
          <ToolSearchInput
            value={q}
            onChange={(v) => {
              typed.current = true;
              setQ(v);
            }}
          />
        </div>
      </section>
      <div className="page-container pt-8">
        <h2 className="filter-heading">Categories</h2>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {[
            { slug: "", label: "All" },
            ...result.categories.map((c) => ({ slug: c.slug, label: shortName(c.name) })),
          ].map((c) => (
            <button
              key={c.label}
              onClick={() =>
                void navigate({
                  search: (s: ToolsSearch) => ({ ...s, category: c.slug || undefined }),
                })
              }
              aria-pressed={result.category === c.slug}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                result.category === c.slug
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Filter by pricing" className="filter-section">
          <h2 className="filter-heading">Pricing</h2>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", ...PRICING_MODELS] as PricingFilter[]).map((p) => {
              const on = (result.pricing ?? "all") === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    void navigate({
                      search: (s: ToolsSearch) => ({ ...s, pricing: p === "all" ? undefined : p }),
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-primary/40"
                  }`}
                >
                  {p === "all" ? "All" : PRICING_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6 2xl:grid-cols-4"
          aria-busy={busy}
        >
          {items.map((t) => (
            <ToolCard key={t.slug} tool={t} />
          ))}
        </div>
        {result.total === 0 && !busy && (
          <p className="py-20 text-center text-muted-foreground">
            {(result.pricing ?? "all") !== "all"
              ? `No tools with ${PRICING_LABELS[result.pricing as Exclude<PricingFilter, "all">]} pricing match yet. Pricing is shown only once it has been verified for a tool.`
              : "No tools match your search."}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-6 text-center text-sm text-destructive">
            Could not load tools. Please try again.
          </p>
        )}
        {items.length < result.total && (
          <div className="mt-10 text-center">
            <button
              onClick={() => void loadMore()}
              disabled={busy}
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
            >
              {busy ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
